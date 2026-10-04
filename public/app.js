const $=id=>document.getElementById(id);
const api=async(u,m='GET',b)=>{const r=await fetch('/api/'+u,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(d.error||'Error'),{status:r.status});return d;};
const li=(parent,main,sub)=>{const l=document.createElement('li');l.textContent=main;const s=document.createElement('small');s.textContent=sub;l.appendChild(s);parent.appendChild(l);};
const names=['Watching','Alexa nudge','Fire TV alert','Family alert'];
const types={door:'Door',motion:'Motion',kitchen:'Kitchen',alexa:'Talked to Alexa',tv:'Watched TV',med_ack:'Took medication'};
async function auth(p){try{$('err').textContent='';await api(p,'POST',{elder:$('elder').value,email:$('email').value,password:$('pw').value});start();}catch(e){$('err').textContent=e.message;}}
$('reg').onclick=()=>auth('register');$('log').onclick=()=>auth('login');
$('out').onclick=async()=>{await api('logout','POST');location.reload();};
for(const t in types){const b=document.createElement('button');b.textContent=types[t];b.onclick=async()=>{await api('events','POST',{type:t});load();};$('chips').appendChild(b);}
$('s1').onclick=async()=>{await api('simulate','POST',{scenario:'normal'});load();};
$('s2').onclick=async()=>{await api('simulate','POST',{scenario:'missed'});load();};
const msgs=n=>[null,['Alexa says (on the Echo)',`Good morning ${n}, did you take your tablets?`,'Yes, I did'],
 ['Fire TV (large-text alert on screen)',`${n}, please press OK so your family knows you are fine.`,'I am OK'],
 ['Text message sent to family',`CareLoop: no activity from ${n} for a long time. Please check in with them.`,'Mark as checked']];
$('ladder').replaceChildren(...names.map((n,i)=>{const d=document.createElement('button');d.className='step';d.textContent=n;
 d.onclick=async()=>{if(!i)return load();try{await api('alerts/send','POST',{level:i});}catch(e){return;}
  const s=await api('status');const m=msgs(s.elder)[i];$('mt').textContent=m[0];$('mb').textContent=m[1];$('mok').textContent=m[2];
  document.querySelector('.box').className='box'+(i===2?' tv':'');$('modal').hidden=false;$('mok').focus();load();};return d;}));
$('mx').onclick=()=>{$('modal').hidden=true;};
$('mok').onclick=async()=>{await api('events','POST',{type:'alexa'});$('modal').hidden=true;load();};
async function load(){try{const s=await api('status');
 $('who').textContent=s.elder;$('act').textContent=s.action;$('why').textContent=s.reason;$('lvl').textContent=s.level;
 $('hero').className='hero l'+s.level;[...$('ladder').children].forEach((d,i)=>d.classList.toggle('on',i===s.level&&s.level>0));
 $('alerts').replaceChildren();s.alerts.forEach(a=>li($('alerts'),`${names[a.level]}${a.acked?' (answered)':''}`,a.reason+' - '+new Date(a.created_at).toLocaleString()));
 if(!s.alerts.length)li($('alerts'),'No alerts. All calm.','');
 $('events').replaceChildren();s.events.forEach(e=>li($('events'),types[e.type],new Date(e.created_at).toLocaleString()));
 if(!s.events.length)li($('events'),'No activity yet','Log one above or run a demo scenario.');
 }catch(e){if(e.status===401){$('app').hidden=true;$('auth').hidden=false;}}}
function start(){$('auth').hidden=true;$('app').hidden=false;load();setInterval(load,15000);}
api('status').then(start).catch(()=>{});