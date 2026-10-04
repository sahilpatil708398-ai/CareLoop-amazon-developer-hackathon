require('dotenv').config();
const express=require('express'),helmet=require('helmet'),rateLimit=require('express-rate-limit'),
mysql=require('mysql2/promise'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),cookieParser=require('cookie-parser'),
fs=require('fs'),path=require('path');
const {PORT=3000,DB_HOST='localhost',DB_USER='root',DB_PASSWORD='',DB_NAME='careloop',JWT_SECRET}=process.env;
if(!JWT_SECRET||JWT_SECRET.length<32){console.error('Set JWT_SECRET (32+ chars) in .env');process.exit(1);}
const TYPES=['door','motion','kitchen','alexa','tv','med_ack'];
const LEVELS=[['wait','Watching quietly'],['alexa','Alexa voice nudge'],['firetv','Fire TV large-text alert'],['family','Text/call to family']];
let db;
const app=express();
app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'","https://fonts.googleapis.com"],fontSrc:["https://fonts.gstatic.com"],scriptSrc:["'self'"],imgSrc:["'self'","data:"]}}}));
app.use(express.json({limit:'10kb'}));
app.use(cookieParser());
app.use('/api',rateLimit({windowMs:60000,limit:120}));
const authLimit=rateLimit({windowMs:15*60000,limit:15,message:{error:'Too many attempts. Try again in 15 minutes.'}});
app.use('/api',(req,res,next)=>{ // CSRF defence: JSON only for writes + SameSite cookie
 if(req.method!=='GET'&&!req.is('application/json'))return res.status(415).json({error:'JSON required'});next();});
const wrap=f=>(req,res)=>f(req,res).catch(e=>{console.error(e);res.status(500).json({error:'Server error'});});
const auth=(req,res,next)=>{try{req.uid=jwt.verify(req.cookies.token,JWT_SECRET).uid;next();}catch{res.status(401).json({error:'Please log in'});}};
const setCookie=(res,uid)=>res.cookie('token',jwt.sign({uid},JWT_SECRET,{expiresIn:'8h'}),{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',maxAge:8*3600e3});
const str=(v,min,max)=>typeof v==='string'&&v.trim().length>=min&&v.trim().length<=max;

app.post('/api/register',authLimit,wrap(async(req,res)=>{
 const {email,password,elder}=req.body||{};
 if(!str(email,5,120)||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))return res.status(400).json({error:'Enter a valid email'});
 if(!str(password,8,72))return res.status(400).json({error:'Password must be 8-72 characters'});
 if(!str(elder,1,60))return res.status(400).json({error:"Enter your relative's name"});
 const [ex]=await db.execute('SELECT id FROM users WHERE email=?',[email.trim().toLowerCase()]);
 if(ex.length)return res.status(409).json({error:'Email already registered'});
 const [r]=await db.execute('INSERT INTO users(email,pass_hash,elder_name) VALUES(?,?,?)',[email.trim().toLowerCase(),await bcrypt.hash(password,12),elder.trim()]);
 setCookie(res,r.insertId);res.json({ok:true});}));
app.post('/api/login',authLimit,wrap(async(req,res)=>{
 const {email,password}=req.body||{};
 if(!str(email,3,120)||!str(password,1,72))return res.status(400).json({error:'Enter email and password'});
 const [u]=await db.execute('SELECT id,pass_hash FROM users WHERE email=?',[email.trim().toLowerCase()]);
 if(!u.length||!(await bcrypt.compare(password,u[0].pass_hash)))return res.status(401).json({error:'Wrong email or password'});
 setCookie(res,u[0].id);res.json({ok:true});}));
app.post('/api/logout',(req,res)=>{res.clearCookie('token');res.json({ok:true});});

// The care agent: explainable rules -> wait / nudge / escalate. (Swap in Amazon Bedrock here if desired.)
async function assess(uid){
 const [[s]]=await db.execute(`SELECT TIMESTAMPDIFF(MINUTE,MAX(created_at),NOW()) idle,HOUR(NOW()) hr,
  (SELECT COUNT(*) FROM events WHERE user_id=? AND type='med_ack' AND DATE(created_at)=CURDATE()) med,
  (SELECT COUNT(*) FROM events WHERE user_id=? AND DATE(created_at)=CURDATE()) today FROM events WHERE user_id=?`,[uid,uid,uid]);
 const idle=s.idle==null?null:Number(s.idle),hr=Number(s.hr),med=Number(s.med);
 let level=0,why=[];
 if(hr<7||hr>=22)return {level:0,idle,med,reason:'Quiet hours (10 PM-7 AM). No alerts are sent while your relative sleeps.'};
 if(idle===null){level=1;why.push('No activity has been recorded yet today.');}
 else{
  if(idle>=90)level=1; if(idle>=150)level=2; if(idle>=210)level=3;
  why.push(idle<90?`Last activity ${idle} min ago, which is normal.`:`No activity for ${idle} minutes during waking hours.`);}
 if(hr>=11&&!med){level=Math.max(level,1);why.push('Morning medication has not been confirmed.');}
 if(hr>=15&&!med){level=Math.max(level,2);}
 return {level,idle,med,reason:why.join(' ')};}
app.get('/api/status',auth,wrap(async(req,res)=>{
 const a=await assess(req.uid);
 const [[u]]=await db.execute('SELECT elder_name FROM users WHERE id=?',[req.uid]);
 if(a.level>0){const [r]=await db.execute('SELECT id FROM alerts WHERE user_id=? AND level>=? AND created_at>NOW()-INTERVAL 30 MINUTE',[req.uid,a.level]);
  if(!r.length)await db.execute('INSERT INTO alerts(user_id,level,channel,reason) VALUES(?,?,?,?)',[req.uid,a.level,LEVELS[a.level][0],a.reason]);}
 const [alerts]=await db.execute('SELECT id,level,channel,reason,acked,created_at FROM alerts WHERE user_id=? ORDER BY id DESC LIMIT 8',[req.uid]);
 const [events]=await db.execute('SELECT type,created_at FROM events WHERE user_id=? ORDER BY id DESC LIMIT 12',[req.uid]);
 res.json({elder:u.elder_name,level:a.level,action:LEVELS[a.level][1],reason:a.reason,idle:a.idle,medDone:a.med>0,alerts,events});}));
app.post('/api/events',auth,wrap(async(req,res)=>{
 const {type}=req.body||{};
 if(!TYPES.includes(type))return res.status(400).json({error:'Unknown event type'});
 await db.execute('INSERT INTO events(user_id,type) VALUES(?,?)',[req.uid,type]);
 if(type==='alexa'||type==='motion'||type==='med_ack')await db.execute('UPDATE alerts SET acked=1 WHERE user_id=? AND acked=0',[req.uid]);
 res.json({ok:true});}));
app.post('/api/simulate',auth,wrap(async(req,res)=>{
 const {scenario}=req.body||{};
 await db.execute('DELETE FROM events WHERE user_id=? AND DATE(created_at)=CURDATE()',[req.uid]);
 if(scenario==='normal'){for(const t of ['door','kitchen','med_ack','tv'])await db.execute('INSERT INTO events(user_id,type) VALUES(?,?)',[req.uid,t]);}
 else if(scenario==='missed')await db.execute("INSERT INTO events(user_id,type,created_at) VALUES(?,'door',NOW()-INTERVAL 4 HOUR)",[req.uid]);
 else return res.status(400).json({error:'Unknown scenario'});
 res.json({ok:true});}));
app.post('/api/alerts/:id/ack',auth,wrap(async(req,res)=>{
 await db.execute('UPDATE alerts SET acked=1 WHERE id=? AND user_id=?',[parseInt(req.params.id,10)||0,req.uid]);res.json({ok:true});}));

app.post('/api/alerts/send',auth,wrap(async(req,res)=>{
 const lv=Number(req.body&&req.body.level);
 if(![1,2,3].includes(lv))return res.status(400).json({error:'Level must be 1, 2 or 3'});
 const reason=`Manual test: ${LEVELS[lv][1]} sent from the dashboard.`;
 await db.execute('INSERT INTO alerts(user_id,level,channel,reason) VALUES(?,?,?,?)',[req.uid,lv,LEVELS[lv][0],reason]);
 res.json({ok:true});}));

app.use(express.static(path.join(__dirname,'public')));
app.use((req,res)=>res.status(404).json({error:'Not found'}));
app.use((req,res)=>res.status(404).json({error:'Not found'}));
(async()=>{
 const c=await mysql.createConnection({host:DB_HOST,user:DB_USER,password:DB_PASSWORD,multipleStatements:true});
 await c.query(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8').replace(/careloop/g,DB_NAME.replace(/[^\w]/g,'')));await c.end();
 db=mysql.createPool({host:DB_HOST,user:DB_USER,password:DB_PASSWORD,database:DB_NAME,connectionLimit:10});
 app.listen(PORT,'127.0.0.1',()=>console.log(`CareLoop running -> http://localhost:${PORT}`));
})().catch(e=>{console.error('Database error:',e.message);process.exit(1);});
