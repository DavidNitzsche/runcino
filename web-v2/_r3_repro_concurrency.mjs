import fs from 'fs';
import pg from 'pg';
const env = fs.readFileSync('.env.local','utf8');
const roUrl = env.match(/^DATABASE_URL_RO=(.+)$/m)[1].trim().replace(/^["']|["']$/g,'');
const BASE='https://www.faff.run';
const EMAIL='test-onboarding@faff.run', PW='Faff2026!';
const UUID='b8b75dd8-2a04-48b4-8896-44897d9e0b25';

async function ro(){ const c=new pg.Client({connectionString:roUrl, ssl:{rejectUnauthorized:false}}); await c.connect(); return c; }
async function actives(c){
  const r=await c.query(`SELECT id, to_char(authored_iso,'YYYY-MM-DD HH24:MI:SS.US') AS a, race_id, mode FROM training_plans WHERE user_uuid=$1 AND archived_iso IS NULL ORDER BY authored_iso DESC`,[UUID]);
  return r.rows;
}

const login = await fetch(`${BASE}/api/auth/email`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:EMAIL,password:PW})});
const lj = await login.json();
console.log('login', login.status, 'ok='+lj.ok, 'uuid='+lj.user_uuid);
if(!lj.token){ console.log('no token', JSON.stringify(lj)); process.exit(1);}
const TOK = lj.token;
const gen = (slug) => fetch(`${BASE}/api/plan/generate`,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${TOK}`},body:JSON.stringify({raceSlug:slug})});

const c = await ro();
const races = await c.query(`SELECT slug, meta->>'date' AS d, meta->>'priority' AS p FROM races WHERE user_uuid=$1 AND (meta->>'date')::date > now()::date ORDER BY (meta->>'date')::date ASC`,[UUID]);
let slug = races.rows.find(r=>r.p==='A'||r.p==='B')?.slug || races.rows[0]?.slug;
console.log('race slug:', slug, '| future races:', races.rows.length);

// seed one plan to baseline
const seed = await gen(slug);
console.log('seed', seed.status);
await new Promise(r=>setTimeout(r,1500));
console.log('baseline actives:', (await actives(c)).length);

let bugTrials=0;
for(let t=1;t<=3;t++){
  const [a,b]=await Promise.all([gen(slug), gen(slug)]);
  await new Promise(r=>setTimeout(r,2000));
  const act = await actives(c);
  const bug = act.length>1;
  if(bug) bugTrials++;
  console.log(`TRIAL ${t}: http=[${a.status},${b.status}] actives=${act.length}` + (bug?`  <== BUG ids=[${act.map(x=>x.id).join(', ')}] authored=[${act.map(x=>x.a).join(' | ')}]`:''));
}
console.log(`\nRESULT: ${bugTrials}/3 trials left >1 active plan`);
await c.end();
