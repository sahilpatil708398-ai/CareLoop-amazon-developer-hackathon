# CareLoop: Ambient Care Companion
Node.js + Express + MySQL. Explainable care agent (wait -> Alexa nudge -> Fire TV alert -> family alert).

## Run it
1. Install Node.js 18+ (nodejs.org) and MySQL 8 (make sure it is running).
2. In this folder: `npm install`
3. Copy `.env.example` to `.env`. Set DB_PASSWORD to your MySQL password and JWT_SECRET to a long random string (32+ chars).
4. `npm start` (tables are created automatically; `schema.sql` is there for reference).
5. Open http://localhost:3000, create an account, and use the demo buttons:
   - "Normal day" -> level 0, calm.
   - "Missed routine" -> escalates (no activity 4 hours). Logging activity acknowledges alerts.
   Note: no alerts are raised 10 PM-7 AM (quiet hours), so test during the day.

## Security built in
bcrypt password hashing, JWT in httpOnly SameSite=Strict cookie, 100% parameterized SQL (no SQL injection),
Helmet + strict CSP, rate limiting (login brute-force limit), input validation, 10KB body cap,
JSON-only writes (CSRF defence), XSS-safe rendering (textContent), per-user data isolation, localhost-only bind.
For production use HTTPS and NODE_ENV=production.

## Honest notes
Events are logged manually or simulated. Alexa/Fire TV/SNS/Bedrock are the planned integrations
(see `assess()` in server.js to plug in Bedrock; say clearly in your Devpost submission that signals are simulated).
