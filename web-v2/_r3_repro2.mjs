import fs from 'fs'; import pg from 'pg';
const env=fs.readFileSync('.env.local','utf8');
const roUrl=env.match(/^DATABASE_URL_RO=(.+)$/m)[1].trim().replace(/^["']|["']$/g,'');
const BASE='https://www.faff.run';
const UUID='b8b75dd8-2a04-48b4-8896-44897d9e0b25';
async function ro(){const c=new pg.Client({connectionString:roUrl,ssl:{rejectUnauthorized:false}});await c.connect();return c;}
async function actives(c){return (await c.query(`SELECT id, to_char(authored_iso,'HH24:MI:SS.US') AS a, race_id FROM training_plans WHERE user_uuid=$1 AND archived_iso IS NULL ORDER BY authored_iso DESC`,[UUID])).rows;}

const login=await fetch(`${BASE}/api/auth/email`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'test-onboarding@faff.run',password:'Faff2026!'})});
const TOK=(await login.json()).token;
const H={'content-type':'application/json','authorization':`Bearer ${TOK}`};

// unique race name so the slug is mine
const stamp = Date.now().toString(36);
const name = `R3 Concurrency Probe ${stamp}`;
const date = '2026-12-13'; // ~25wk out, marathon-friendly window
const mkRace = await fetch(`${BASE}/api/race`,{method:'POST',headers:H,body:JSON.stringify({name, date, distance_label:'Marathon', priority:'A'})});
const mr = await mkRace.json();
console.log('create race:', mkRace.status, JSON.stringify(mr).slice(0,200));
const slug = mr.slug;
if(!slug){console.log('no slug, abort'); process.exit(1);}

const gen=(s)=>fetch(`${BASE}/api/plan/generate`,{method:'POST',headers:H,body:JSON.stringify({raceSlug:s})});
await new Promise(r=>setTimeout(r,1500));
const c=await ro();
console.log('after-create actives:', (await actives(c)).length, '(create with priority A auto-generates one)');

let bug=0;
for(let t=1;t<=5;t++){
  // verify race still exists right before firing (guard against the other session)
  const exists=(await c.query(`SELECT 1 FROM races WHERE slug=$1 AND user_uuid=$2`,[slug,UUID])).rowCount;
  if(!exists){console.log(`TRIAL ${t}: race vanished, skip`); continue;}
  const [a,b]=await Promise.all([gen(slug), gen(slug)]);
  const ba = a.status===200?'ok':await a.text();
  const bb = b.status===200?'ok':await b.text();
  await new Promise(r=>setTimeout(r,2200));
  const act=await actives(c);
  const isbug = act.length>1;
  if(isbug) bug++;
  console.log(`TRIAL ${t}: http=[${a.status},${b.status}] bodies=[${ba},${bb}] actives=${act.length}` + (isbug?`  <== BUG ids=[${act.map(x=>x.id).join(', ')}] @[${act.map(x=>x.a).join(' | ')}]`:''));
}
console.log(`\nRESULT: ${bug}/5 trials left >1 ACTIVE plan. race slug=${slug}`);
await c.end();
