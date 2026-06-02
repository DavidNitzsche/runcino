/* faff-hero.js — renders the post-run hero shell + per-type right panel.
   One shared shell (locked); the right card's inner panel changes by type. */

/* ---------- small helpers ---------- */
function el(id){ return document.getElementById(id); }
function phead(rt, rg){
  return '<div class="phead"><span class="rt">'+rt+'</span><span class="rg">'+(rg||'')+'</span></div>';
}
function third(label, big, sub, warn){
  return '<div class="third'+(warn?' warn':'')+'"><div class="tl">'+label+'</div>'
    + '<div class="tp">'+big+'</div><div class="th">'+sub+'</div></div>';
}
function permile(arr){
  return '<div class="permile">'+arr.map(function(m){
    return '<span'+(m[2]?' class="warn"':'')+'>'+m[0]+'<b>'+m[1]+'</b></span>';
  }).join('')+'</div>';
}
/* centre-anchored comparison bar: target = centre tick, faster→right, slower→left */
function cmpBar(actualSec, goalSec, maxdev){
  var d = actualSec - goalSec;                    // + slower · − faster
  var cls = d > 0 ? 'warn' : 'good';
  var mag = Math.max(Math.min(Math.abs(d)/maxdev, 1) * 50, 5);
  var style = d > 0 ? ('left:'+(50-mag)+'%;width:'+mag+'%') : ('left:50%;width:'+mag+'%');
  if(d === 0) style = 'left:47%;width:6%';
  return '<div class="cmpbar"><div class="cmpfill '+cls+'" style="'+style+'"></div><div class="cmpaxis"></div></div>'
    + '<div class="cmplegend"><span class="s">\u25c2 SLOWER</span><span class="t">TARGET</span><span class="f">FASTER \u25b8</span></div>';
}
/* mile-pace footprint · vertical bars, taller = faster */
function footprint(secs, avgSec, avgLabel){
  var all=secs.concat(avgSec);
  var mn=Math.min.apply(null,all), mx=Math.max.apply(null,all), rng=Math.max(mx-mn,1);
  var H=function(s){ return 30+(mx-s)/rng*64; };               // % height, faster = taller
  var bars=secs.map(function(s){ return '<i style="height:'+Math.round(H(s))+'%"></i>'; }).join('');
  var ticks=secs.map(function(s,i){ return '<span>'+(i+1)+'</span>'; }).join('');
  var avgTop=(100-H(avgSec)).toFixed(1);
  return '<div class="fbars"><div class="favg" style="top:'+avgTop+'%"><span>'+avgLabel+'</span></div>'+bars+'</div>'
    + '<div class="fticks">'+ticks+'</div>';
}
/* two-bar heart-rate drift (HR window 120-170 bpm) */
function driftBar(label, bpm, hi){
  var w=Math.max(6,Math.min(100,(bpm-120)/50*100));
  return '<div class="driftrow"><span class="dl">'+label+'</span>'
    + '<div class="dt"><div class="df'+(hi?' hi':'')+'" style="width:'+w+'%"></div></div>'
    + '<span class="dv">'+bpm+'<small> bpm</small></span></div>';
}

/* ---------- per-type panels (the inner shape that changes) ---------- */
var PANELS = {
  easy: function(){
    return phead('AEROBIC STAMP','')
      + '<div class="gauge"><div class="gaugehd"><span class="gl">KEPT IT EASY</span><span class="gv">94%</span></div>'
        + '<div class="gtrack"><div class="gfill good" style="width:94%"></div></div>'
        + '<div class="gcap">Z1\u2013Z2 share of moving time</div></div>'
      + '<div class="psec"><div class="drifthd"><span class="plabel">HEART RATE DRIFT</span><span class="tag good">STAYED FLAT</span></div>'
        + '<div class="drift">'
          + driftBar('FIRST HALF', 142, false)
          + driftBar('SECOND HALF', 145, true)
          + '<div class="driftcap">Same pace throughout, but your heart only beat <b class="good">+3 bpm</b> faster in the back half. The engine stayed flat \u00b7 a genuinely easy run.</div>'
        + '</div></div>'
      + '<div class="psec"><div class="plabel">MILE PACE</div>'
        + footprint([532,520,514,508,514,510,505,502], 511, '8:31 avg')
        + '<div class="sparkcap">8 miles \u00b7 fastest 8:22 \u00b7 slowest 8:52 \u00b7 only 30s spread</div></div>';
  },

  long: function(){
    return phead('THE LONG','12.4 MI')
      + '<div class="thirds">'
        + third('FIRST 3','8:54','142 \u2665', false)
        + third('MIDDLE 3','8:58','148 \u2665', false)
        + third('FINAL 3','9:12','154 \u2665', true)
      + '</div>'
      + '<div class="psec"><div class="drifthd"><span class="plabel">HEART RATE DRIFT</span><span class="tag warn">LATE FADE</span></div>'
        + '<div class="drift">'
          + driftBar('FIRST THIRD', 142, false)
          + driftBar('FINAL THIRD', 154, true)
          + '<div class="driftcap">Pace held, but your heart climbed <b class="warn">+12 bpm</b> from the first third to the last. Normal late-run fade \u00b7 the engine worked harder to hold the same speed.</div>'
        + '</div></div>';
  },

  mp: function(){
    return phead('THE BUILD','12 MI \u00b7 8 + 4')
      // block 1 · aerobic base
      + '<div class="psec"><div class="blockhd"><span class="bn">AEROBIC BASE<em>8 MI</em></span><span class="bp">8:54<small>/mi</small></span></div>'
        + '<div class="ribbon"></div>'
        + '<div class="blockmeta"><span>Held easy through the build.</span><span>142 bpm</span></div></div>'
      // transition
      + '<div class="shift"><span class="sa">\u2193 MP SHIFT</span>'
        + '<div class="sp">Last easy <b>9:02</b> \u2192 first MP <b>7:48</b></div>'
        + '<div class="sd good">\u22121:14 gear change</div></div>'
      // block 2 · marathon shift
      + '<div class="psec"><div class="blockhd"><span class="bn">MARATHON SHIFT<em>4 MI</em></span><span class="bp">7:42<small>/mi</small></span></div>'
        + '<div class="blockmeta"><span>TARGET 7:50/mi</span><span>161 bpm</span></div>'
        + cmpBar(462, 470, 18)
        + permile([['mi 9','7:48'],['mi 10','7:45'],['mi 11','7:39'],['mi 12','7:36']]) + '</div>';
  },

  tempo: function(){
    return phead('THE TEMPO','20 MIN')
      + '<div class="psec"><div class="blockhd"><span class="bn">TEMPO BLOCK<em>20 MIN</em></span><span class="bp">7:08<small>/mi</small></span></div>'
        + '<div class="blockmeta"><span>TARGET 7:12/mi</span><span>167 bpm</span></div>'
        + cmpBar(428, 432, 14) + '</div>'
      + '<div class="psec"><div class="plabel">HR ACROSS THE BLOCK</div>'
        + '<div class="thirds">'
          + third('EARLY','165','bpm', false)
          + third('MIDDLE','167','bpm', false)
          + third('LATE','169','bpm', false)
        + '</div></div>'
      + '<div class="wucd"><div><span class="k">WARM-UP</span>1.0 mi \u00b7 <b>9:24</b></div>'
        + '<div style="text-align:right"><span class="k">COOL-DOWN</span>1.0 mi \u00b7 <b>9:40</b></div></div>';
  }
};

/* ---------- per-type content ---------- */
var TYPES = {
  easy: {
    theme:'t-easy', accentHex:'#37c98f', eyebrow:'TODAY \u00b7 EASY \u00b7 DONE', title:'EASY',
    weekmeta:'5.8 mi \u00b7 8:31',
    stats:[['5.8',' mi','DISTANCE'],['49:26','','TIME'],['8:31','/mi','AVG PACE']],
    zavg:143, zpk:153, zones:[['Z1',22],['Z2',70],['Z3',8],['Z4',0],['Z5',0]],
    form:[['CADENCE','178',' spm'],['RUN POWER','268',' W'],['STRIDE','1.08',' m'],['VERT OSC','8.9',' cm'],['GROUND CONTACT','252',' ms'],['L/R BALANCE','50',' / 50']],
    cond:{wx:'54\u00b0 \u00b7 Calm', shoe:'Vomero Plus', elev:'215 ft', cal:'612 kcal'},
    badge:['ON PLAN','ok'], verdict:'Engine parked.',
    recap:'Held Zone 2 the whole way and never let the pace creep, even late. The quiet aerobic work that builds the engine.',
    sum:['AVG HR','143<small> bpm</small>','\u221212 vs threshold','good']
  },
  long: {
    theme:'t-long', accentHex:'#F3AD38', eyebrow:'TODAY \u00b7 LONG RUN \u00b7 DONE', title:'LONG RUN',
    weekmeta:'12.4 mi \u00b7 8:58',
    stats:[['12.4',' mi','DISTANCE'],['1:51:00','','TIME'],['8:58','/mi','AVG PACE']],
    zavg:148, zpk:158, zones:[['Z1',12],['Z2',66],['Z3',20],['Z4',2],['Z5',0]],
    form:[['CADENCE','176',' spm'],['RUN POWER','278',' W'],['STRIDE','1.12',' m'],['VERT OSC','9.2',' cm'],['GROUND CONTACT','256',' ms'],['L/R BALANCE','50',' / 50']],
    cond:{wx:'58\u00b0 \u00b7 Clear', shoe:'Ghost 16', elev:'410 ft', cal:'1340 kcal'},
    badge:['ON PLAN','ok'], verdict:'Engine held.',
    recap:'Two thirds clean, then HR drifted up over the final 5K while pace stayed put. Normal long-run fade \u00b7 fuel a touch earlier next time.',
    sum:['AVG PACE','8:58<small>/mi</small>','held to mi 9','good']
  },
  mp: {
    theme:'t-mp', accentHex:'#ff9f5a', eyebrow:'TODAY \u00b7 LONG \u00b7 MP FINISH', title:'MP FINISH',
    weekmeta:'12.0 mi \u00b7 8:30',
    stats:[['12.0',' mi','DISTANCE'],['1:42:00','','TIME'],['8:30','/mi','AVG PACE']],
    zavg:150, zpk:165, zones:[['Z1',8],['Z2',54],['Z3',24],['Z4',12],['Z5',2]],
    form:[['CADENCE','180',' spm'],['RUN POWER','296',' W'],['STRIDE','1.16',' m'],['VERT OSC','8.6',' cm'],['GROUND CONTACT','244',' ms'],['L/R BALANCE','50',' / 50']],
    cond:{wx:'60\u00b0 \u00b7 Clear', shoe:'Superblast 3', elev:'380 ft', cal:'1290 kcal'},
    badge:['ON PLAN','ok'], verdict:'Hit the shift.',
    recap:'Banked eight honest easy miles, then dropped 1:14 into marathon pace and held it for four. The gear change the plan wanted.',
    sum:['MP BLOCK','7:42<small>/mi</small>','\u22128 vs goal','good']
  },
  tempo: {
    theme:'t-tempo', accentHex:'#ff8a47', eyebrow:'TODAY \u00b7 TEMPO \u00b7 DONE', title:'TEMPO',
    weekmeta:'6.2 mi \u00b7 7:17',
    stats:[['6.2',' mi','DISTANCE'],['45:10','','TIME'],['7:17','/mi','AVG PACE']],
    zavg:162, zpk:171, zones:[['Z1',14],['Z2',18],['Z3',26],['Z4',38],['Z5',4]],
    form:[['CADENCE','184',' spm'],['RUN POWER','318',' W'],['STRIDE','1.20',' m'],['VERT OSC','8.2',' cm'],['GROUND CONTACT','238',' ms'],['L/R BALANCE','50',' / 50']],
    cond:{wx:'61\u00b0 \u00b7 Clear', shoe:'Zoom Fly 6', elev:'190 ft', cal:'720 kcal'},
    badge:['ON PLAN','ok'], verdict:'Sat on the line.',
    recap:'Locked onto threshold and parked there. HR crept just four beats across the block. Controlled, never reckless.',
    sum:['TEMPO','7:08<small>/mi</small>','\u22124 vs goal','good']
  }
};

var ZC = ['var(--z1a)','var(--z2a)','var(--z3a)','var(--z4a)','var(--z5a)'];
var CK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>';

/* ---------- week strip ---------- */
function renderWeek(t){
  var WEEK = [
    {dw:'MON',dn:18,meta:'6.0 mi \u00b7 8:42',dot:'#37c98f',done:true},
    {dw:'TUE',dn:19,meta:'7.5 mi \u00b7 8:09',dot:'#ec3a54',done:true},
    {dw:'WED',dn:20,meta:t.weekmeta,dot:t.accentHex,done:true,on:true},
    {dw:'THU',dn:21,meta:'6.0 mi \u00b7 8:40',dot:'#37c98f'},
    {dw:'FRI',dn:22,meta:'5.5 mi \u00b7 8:20',dot:'#37c98f'},
    {dw:'SAT',dn:23,meta:'rest',dot:'#8A90A0'},
    {dw:'SUN',dn:24,meta:'12.0 mi \u00b7 8:00',dot:'#F3AD38'}
  ];
  el('week').innerHTML = WEEK.map(function(d){
    return '<div class="day'+(d.on?' on':'')+'">'
      + '<div class="dtop"><span class="dday"><span class="dw">'+d.dw+'</span><span class="dn">'+d.dn+'</span></span>'
      + '<span class="dstate">'+(d.done?'<span class="dck">'+CK+'</span>':'')+'</span></div>'
      + '<div class="dmeta"><span class="ddot" style="background:'+d.dot+'"></span><span class="ddist">'+d.meta+'</span></div></div>';
  }).join('');
}

/* ---------- render a whole type ---------- */
function renderType(key){
  var t = TYPES[key];
  el('pr').className = 'pr ' + t.theme;

  el('htag').textContent = t.eyebrow;
  el('htitle').textContent = t.title;

  el('stats').innerHTML = t.stats.map(function(s){
    return '<div class="stat"><div class="v">'+s[0]+(s[1]?'<small>'+s[1]+'</small>':'')+'</div><div class="k">'+s[2]+'</div></div>';
  }).join('');

  el('zavg').textContent = t.zavg; el('zpk').textContent = t.zpk;
  el('zbar').innerHTML = t.zones.map(function(z,i){ return z[1]>0?'<i style="width:'+z[1]+'%;background:'+ZC[i]+'"></i>':''; }).join('');
  el('zleg').innerHTML = t.zones.map(function(z,i){
    return '<div style="opacity:'+(z[1]===0?0.4:1)+'"><span class="zs" style="background:'+ZC[i]+'"></span>'+z[0]+' <b>'+z[1]+'%</b></div>';
  }).join('');

  el('formgrid').innerHTML = t.form.map(function(f){
    return '<div class="fm"><div class="fk">'+f[0]+'</div><div class="fv">'+f[1]+'<small>'+f[2]+'</small></div></div>';
  }).join('');

  el('cond').innerHTML =
      '<div><div class="kcl">WEATHER</div><div class="kcv">'+t.cond.wx+'</div></div>'
    + '<div><div class="kcl">SHOE</div><div class="kcv"><select class="shoesel" aria-label="Shoe"><option selected>'+t.cond.shoe+'</option><option>Vaporfly 3</option><option>Vomero Plus</option><option>Ghost 16</option></select></div></div>'
    + '<div><div class="kcl">ELEV GAIN</div><div class="kcv">'+t.cond.elev+'</div></div>'
    + '<div><div class="kcl">CALORIES</div><div class="kcv">'+t.cond.cal+'</div></div>';

  el('verdict').textContent = t.verdict;
  el('badge').className = 'ok ' + t.badge[1];
  el('badge').innerHTML = CK + ' ' + t.badge[0];
  el('recap').textContent = t.recap;

  var panel = el('panel');
  panel.innerHTML = PANELS[key]();
  el('sumlbl').textContent = t.sum[0];
  el('sumval').innerHTML = t.sum[1] + '<span class="delta '+t.sum[3]+'">'+t.sum[2]+'</span>';

  requestAnimationFrame(function(){ panel.classList.toggle('scrollable', panel.scrollHeight > panel.clientHeight + 2); });
}

/* ---------- switcher ---------- */
var seg = el('seg');
seg.addEventListener('click', function(e){
  var b = e.target.closest('button'); if(!b) return;
  seg.querySelectorAll('button').forEach(function(x){ x.classList.toggle('on', x===b); });
  renderType(b.dataset.t);
});

renderWeek(TYPES.easy);
renderType('easy');
/* keep week dot/colour in sync on switch */
seg.addEventListener('click', function(e){ var b=e.target.closest('button'); if(b) renderWeek(TYPES[b.dataset.t]); });
