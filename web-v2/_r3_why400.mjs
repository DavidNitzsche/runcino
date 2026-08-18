import fs from 'fs';
const BASE='https://www.faff.run';
const login = await fetch(`${BASE}/api/auth/email`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'test-onboarding@faff.run',password:'Faff2026!'})});
const lj = await login.json();
const TOK=lj.token;
const gen = (slug) => fetch(`${BASE}/api/plan/generate`,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${TOK}`},body:JSON.stringify({raceSlug:slug})});
// single call, read full body
const r = await gen('my-5k-2026-09-13');
console.log('status', r.status);
console.log('body', await r.text());
