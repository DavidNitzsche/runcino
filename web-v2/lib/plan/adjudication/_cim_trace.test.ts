import { describe, it, expect } from 'vitest';
import { athleteEvidenceFor, detectStackedStress, expectedAbsorbed, rankOptions, checkPromotion,
  type DemonstratedHistory, type PlannedWeek } from '@/lib/plan/adjudication/adjudicate';
import type { DecisionTrace, OptionAppraisal } from '@/lib/plan/adjudication/contract';

const D: DemonstratedHistory = { peakWeeklyMi:47.5, longestRunMi:18.0, maxCompletedMpMi:5, maxStressorsInAWeek:2, after:[] };
const opt=(o:'PUSH'|'HOLD'|'PULL_BACK',cls:any,d:string):OptionAppraisal=>({option:o,describe:d,evidenceClass:cls,expectedAbsorbedFrac:expectedAbsorbed(cls),risk:''});

const decisions: Array<{id:string,date:string,what:string,presc:number|null,demo:number|null,week?:PlannedWeek,opts:OptionAppraisal[],reassess:string|null}> = [
 {id:'10-26 peak week', date:'2026-10-26', what:'60.0 mi, three stressors', presc:60.0, demo:47.5,
  week:{weekStartISO:'2026-10-26',weeklyMi:60,longestMi:21.5,stressors:['6 mi @ T','9×3 min @ I','21.5 mi long'],mpMi:0,isTaper:false,isRaceWeek:false},
  opts:[opt('PUSH','CONDITIONAL','60.0 mi, all three stressors'),opt('HOLD','ALLOWED','~54 mi, drop the I session'),opt('PULL_BACK','SUPPORTED','~48 mi, two stressors')],reassess:null},
 {id:'11-01 long', date:'2026-11-01', what:'21.5 mi with a 5-mile fast finish at M', presc:21.5, demo:18.0,
  opts:[opt('PUSH','ALLOWED','21.5 with 5 @ M'),opt('HOLD','SUPPORTED','21.5 with 3 @ M'),opt('PULL_BACK','SUPPORTED','20 plain')],reassess:'2026-10-19'},
 {id:'11-15 post-half', date:'2026-11-15', what:'18.0 easy at day 7 post-Malibu', presc:18.0, demo:11.01,
  opts:[opt('PUSH','CONDITIONAL','18.0 easy'),opt('HOLD','ALLOWED','14-15 easy'),opt('PULL_BACK','SUPPORTED','11-12 easy')],reassess:'2026-11-09'},
 {id:'11-22 MP block', date:'2026-11-22', what:'16 mi with 10 at M', presc:10, demo:5,
  opts:[opt('PUSH','CONDITIONAL','10 @ M'),opt('HOLD','ALLOWED','6 @ M'),opt('PULL_BACK','SUPPORTED','4 @ M')],reassess:'2026-11-16'},
 {id:'11-29 primer', date:'2026-11-29', what:'13 mi with last 3 at M', presc:3, demo:5,
  opts:[opt('PUSH','SUPPORTED','3 @ M'),opt('HOLD','SUPPORTED','2 @ M'),opt('PULL_BACK','SUPPORTED','plain')],reassess:null},
];

describe('CIM preview · decision trace under the adjudication standard', () => {
 it('adjudicates every material decision', () => {
  const traces: DecisionTrace[] = decisions.map(d=>{
    const ranked = rankOptions(d.opts);
    const ath = athleteEvidenceFor(d.what, d.presc, d.demo, []);
    const stacked = d.week ? detectStackedStress(d.week, D) : null;
    return { decisionId:d.id, dateISO:d.date, what:d.what, windowDays:14, athlete:ath, stacked,
      options:d.opts, chosen:ranked[0].option, because:`${ranked[0].option} ranks highest on expected adaptation`,
      rejected:ranked.slice(1).map(o=>({option:o.option,why:`lower expected adaptation (${o.evidenceClass})`})),
      conflicts:[], citations:[], reassessOnISO:d.reassess };
  });
  console.log('\n=== DECISION TRACE · CIM preview ===');
  for(const t of traces){
    const r=rankOptions(t.options);
    console.log(`\n${t.decisionId}  (${t.dateISO})`);
    console.log(`  prescribed ${t.athlete.prescribed} vs demonstrated ${t.athlete.demonstratedMax}  →  ${t.athlete.evidenceClass}`
      + (t.athlete.stepOverDemonstrated!=null?`  (${t.athlete.stepOverDemonstrated>0?'+':''}${Math.round(t.athlete.stepOverDemonstrated*1000)/10}%)`:''));
    if(t.stacked) console.log(`  STACKED: ${t.stacked.why}`);
    r.forEach((o,i)=>console.log(`   ${i===0?'→':' '} ${o.option.padEnd(9)} ${String(o.evidenceClass).padEnd(12)} E[adapt]=${((o.expectedAbsorbedFrac??0)*({PUSH:1,HOLD:.85,PULL_BACK:.6} as any)[o.option]).toFixed(2)}  ${o.describe}`));
    console.log(`  CHOSEN: ${t.chosen}${t.reassessOnISO?`   reassess on ${t.reassessOnISO}`:''}`);
  }
  const v = checkPromotion(traces);
  console.log('\n=== PROMOTION VERDICT ===');
  console.log('  mayPromote:', v.mayPromote);
  Object.entries(v.check).forEach(([k,val])=>console.log(`   ${val?'PASS':'FAIL'}  ${k}`));
  v.blockedBecause.forEach(b=>console.log('   BLOCKED · '+b));
  expect(traces.length).toBe(5);
 });
});
