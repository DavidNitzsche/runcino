/* ============================================================
   FAFF · TRAIN page — data + rendering for 3 directions + modal
   ============================================================ */
(function () {
  var TYPE = { easy:'#2faf7c', tempo:'#FF8847', threshold:'#FF8847', intervals:'#FC4D64', long:'#F3AD38', rest:'#8A90A0', race:'#FFCE8A' };
  var PH = {
    base:  { nm:'Base',  wks:'Wk 1–6',   color:'#3FB6B0', desc:'Aerobic engine. Easy volume and durability.', vol:'36–48 mi' },
    build: { nm:'Build', wks:'Wk 7–10',  color:'#E0A23A', desc:'Add HM-pace threshold work. Start sharpening.', vol:'48–57 mi' },
    peak:  { nm:'Peak',  wks:'Wk 11–12', color:'#FF7A45', desc:'Top volume and race-specific speed.', vol:'52–58 mi' },
    taper: { nm:'Taper', wks:'Wk 13',    color:'#34C194', desc:'Shed fatigue, stay sharp, bank the rest.', vol:'40 mi' },
  };
  var WEEKS = [
    { n:1,  mi:36, ph:'base',  key:'Easy base + strides',        done:true },
    { n:2,  mi:40, ph:'base',  key:'First tempo touch',          done:true },
    { n:3,  mi:42, ph:'base',  key:'HM-pace · 3×1.5mi',          done:true },
    { n:4,  mi:44, ph:'base',  key:'Long run · 11mi',            done:true },
    { n:5,  mi:46, ph:'base',  key:'Threshold blocks · 3×2mi',   cur:true },
    { n:6,  mi:48, ph:'base',  key:'Long run · 12.5mi HM finish' },
    { n:7,  mi:50, ph:'build', key:'HM blocks · 2×3mi' },
    { n:8,  mi:53, ph:'build', key:'Longest run · 14mi' },
    { n:9,  mi:49, ph:'build', key:'Cutback + sharpener' },
    { n:10, mi:57, ph:'build', key:'Peak volume · HM time trial' },
    { n:11, mi:58, ph:'peak',  key:'Race-pace · 4×2mi' },
    { n:12, mi:52, ph:'peak',  key:'Sharpener + openers' },
    { n:13, mi:40, ph:'taper', key:'Taper · race openers' },
  ];
  var RACE = { nm:'Americas Finest City Half', date:'Aug 15', goal:'Sub 1:30:00', mi:13.1 };
  var CUR = 4; // index of current week (Wk 5)
  var MAXMI = 58;

  var TW = [
    { dw:'MON', type:'easy',      nm:'Easy',                 meta:'6.5 mi · 8:12', sub:'Zone 2 · conversational', done:true },
    { dw:'TUE', type:'threshold', nm:'HM Threshold Blocks',  meta:'7.5 mi · 6:47', sub:'3 × 2mi @ 6:47 · 90s float', today:true },
    { dw:'WED', type:'easy',      nm:'Easy',                 meta:'6.5 mi · 8:12', sub:'Recover from Tue' },
    { dw:'THU', type:'intervals', nm:'Intervals',            meta:'6.0 mi · 6:05', sub:'8 × 600m @ 6:05 · 200m jog' },
    { dw:'FRI', type:'easy',      nm:'Easy',                 meta:'6.5 mi · 8:12', sub:'Shakeout, legs loose' },
    { dw:'SAT', type:'rest',      nm:'Rest',                 meta:'full recovery', sub:'Sleep + mobility' },
    { dw:'SUN', type:'long',      nm:'Long Run · HM Finish', meta:'12.5 mi · 8:00', sub:'10mi easy + 2.5mi @ HM pace' },
  ];

  var MILES = [
    { wk:'WK 3',  dot:TYPE.tempo,   tt:'HM pace introduced',  ss:'3×1.5mi at goal pace',     st:'DONE', done:true },
    { wk:'WK 5',  dot:TYPE.tempo,   tt:'Threshold blocks',    ss:'3×2mi @ 6:47 · this week', st:'NOW' },
    { wk:'WK 8',  dot:TYPE.long,    tt:'Longest run',         ss:'14mi progressive' },
    { wk:'WK 10', dot:TYPE.intervals, tt:'HM time trial',     ss:'10mi simulation · checkpoint', st:'KEY' },
    { wk:'WK 11', dot:PH.peak.color, tt:'Race-pace 4×2mi',    ss:'at 6:52 goal pace' },
    { wk:'WK 13', dot:PH.taper.color, tt:'Taper + openers',   ss:'sharpen, stay fresh' },
    { wk:'RACE',  dot:TYPE.race,    tt:'Americas Finest Half', ss:'Sub 1:30:00 · Aug 15', race:true },
  ];

  var $ = function (id) { return document.getElementById(id); };
  var CK = '<svg class="tck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';

  /* ---------- phase ramp ---------- */
  function renderRamp() {
    var ramp = $('ramp'), nums = $('rampNums');
    var html = '', nh = '';
    WEEKS.forEach(function (w, i) {
      var c = PH[w.ph].color;
      var h = Math.round((w.mi / MAXMI) * 100);
      var faded = w.done ? 'opacity:.62;' : '';
      html += '<div class="bar' + (w.cur ? ' cur' : '') + '" data-wk="' + i + '" title="Week ' + w.n + ' · ' + w.mi + ' mi" '
        + 'style="height:' + h + '%;background:' + c + ';' + faded + '"><span class="bmi">' + w.mi + '</span></div>';
      nh += '<span>' + w.n + '</span>';
    });
    // race bar
    html += '<div class="bar race" data-wk="race" title="Race day" style="height:30%"></div>';
    nh += '<span style="color:var(--gold);opacity:.85">★</span>';
    ramp.innerHTML = html;
    nums.innerHTML = nh;

    // phase axis
    var phaseSpan = { base:0, build:0, peak:0, taper:0 };
    WEEKS.forEach(function (w) { phaseSpan[w.ph]++; });
    var total = WEEKS.length + 1; // +race
    var pax = '';
    ['base','build','peak','taper'].forEach(function (k) {
      var flex = phaseSpan[k];
      pax += '<div class="pp" style="flex:' + flex + ';color:' + PH[k].color + '">' + PH[k].nm.toUpperCase() + '</div>';
    });
    pax += '<div class="pp" style="flex:1;color:var(--gold)">RACE</div>';
    $('rampPhases').innerHTML = pax;

    ramp.querySelectorAll('.bar').forEach(function (b) {
      b.addEventListener('click', function () {
        var wk = b.dataset.wk;
        if (wk === 'race') { openModal('weeks'); return; }
        focusWeek(+wk);
      });
    });
  }

  function focusWeek(i) {
    var w = WEEKS[i];
    $('ptitle').textContent = PH[w.ph].nm;
    $('eyebrow').innerHTML = RACE.nm.toUpperCase() + ' · <b>' + RACE.goal.toUpperCase() + '</b>';
    $('focusTx').textContent = PH[w.ph].desc;
    $('wkpill').innerHTML = '<span class="dot" style="background:' + PH[w.ph].color + ';box-shadow:0 0 8px ' + PH[w.ph].color + '"></span>WK ' + w.n + ' · ' + w.mi + ' MI';
    var daysOut = (WEEKS.length - 1 - i) * 7;
    $('countdown').innerHTML = '<b>' + daysOut + '</b> days to ' + RACE.date;
    ramp_setCur(i);
  }
  function ramp_setCur(i) {
    $('ramp').querySelectorAll('.bar').forEach(function (b) {
      b.classList.toggle('cur', b.dataset.wk === String(i));
    });
  }

  /* ---------- module builders ---------- */
  function mThisWeek(expanded) {
    var rows = TW.map(function (d) {
      var c = TYPE[d.type];
      var state = d.done ? CK : (d.today ? '<span style="font-size:9px;font-weight:800;letter-spacing:1px;color:var(--gold)">TODAY</span>' : '');
      var sub = expanded ? '<div class="tsub">' + d.sub + '</div>' : '';
      return '<div class="twr' + (d.today ? ' today' : '') + '">'
        + '<span class="tdw">' + d.dw + '</span>'
        + '<span class="tdot" style="background:' + c + '"></span>'
        + '<div class="twrx"><span class="tnm">' + d.nm + '</span>' + sub + '</div>'
        + '<span class="tmeta">' + d.meta + '</span>'
        + (state ? '<span style="margin-left:10px;display:flex;align-items:center">' + state + '</span>' : '')
        + '</div>';
    }).join('');
    return '<div class="card" style="min-height:0">'
      + '<div class="ch"><span class="ct">THIS WEEK · WK 5</span><span class="cx">46 MI PLANNED</span></div>'
      + '<div class="twk">' + rows + '</div></div>';
  }

  function mPhases() {
    var cards = ['base','build','peak','taper'].map(function (k) {
      var p = PH[k], now = (k === 'base');
      return '<div class="phase' + (now ? ' now' : '') + '">'
        + '<span class="pbar" style="background:' + p.color + '"></span>'
        + (now ? '<span class="nowtag">NOW</span>' : '')
        + '<div class="pnm" style="color:' + p.color + '">' + p.nm + '</div>'
        + '<div class="pwk">' + p.wks.toUpperCase() + '</div>'
        + '<div class="pdesc">' + p.desc + '</div>'
        + '<div class="pvol">' + p.vol + ' <small>TARGET VOL</small></div>'
        + '</div>';
    }).join('');
    return '<div class="phgrid">' + cards + '</div>';
  }

  function mProjection() {
    var trend = 'M3 17l6-6 4 4 8-8M15 7h6v6';
    function lever(t, d) {
      return '<div class="lever">'
        + '<span class="lv-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="' + trend + '"/></svg></span>'
        + '<span class="lv-t">' + t + '</span>'
        + '<span class="lv-d">' + d + '</span>'
        + '</div>';
    }
    return '<div class="card proj">'
      + '<div class="ch"><span class="ct">PROJECTION</span><span class="cx">vs Sub 1:30:00</span></div>'
      + '<div class="pjbig amber">1:34:54</div>'
      + '<div class="pjlab">PROJECTED FINISH TODAY</div>'
      + '<div class="pjtrack">'
      +   '<span class="pjzone slow"></span><span class="pjzone fast"></span>'
      +   '<span class="pjseg" style="left:22%;width:28%"></span>'
      +   '<span class="pjend left">SLOWER</span><span class="pjend right">FASTER</span>'
      +   '<span class="pjchip" style="left:36%">4:54 behind</span>'
      +   '<span class="pjtick goal" style="left:50%"></span>'
      +   '<span class="pjtick proj" style="left:22%"></span>'
      +   '<span class="pjlbl" style="left:50%">GOAL<b>1:30:00</b></span>'
      +   '<span class="pjlbl proj" style="left:22%">TODAY<b>1:34:54</b></span>'
      + '</div>'
      + '<div class="gap">'
      +   '<div class="gap-lbl">WHAT CLOSES IT</div>'
      +   '<div class="gap-list">'
      +     lever('One more strong long run + a threshold day each week', '15&ndash;30s / wk')
      +     lever('Marathon-pace integration in the long run', '0.5 VDOT / 4wk')
      +   '</div>'
      + '</div>'
      + '</div>';
  }

  function mMilestones() {
    var rows = MILES.map(function (m) {
      return '<div class="mile' + (m.done ? ' done' : '') + (m.race ? ' race' : '') + '">'
        + '<span class="mwk">' + m.wk + '</span>'
        + '<span class="mdot" style="background:' + m.dot + '"></span>'
        + '<div class="mtx"><div class="mtt">' + m.tt + '</div><div class="mss">' + m.ss + '</div></div>'
        + (m.st ? '<span class="mst" style="' + (m.st === 'NOW' ? 'color:var(--gold);opacity:.95' : '') + '">' + m.st + '</span>' : '')
        + '</div>';
    }).join('');
    return '<div class="card"><div class="ch"><span class="ct">KEY WORKOUTS TO RACE</span></div>'
      + '<div class="miles">' + rows + '</div></div>';
  }

  function fullPlanBtn() {
    return '<button class="ghostbtn" data-openplan><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>Full plan</button>';
  }

  /* all-weeks list (inline for C + modal weeks tab) */
  function mWeekList() {
    var html = '', lastPh = '';
    WEEKS.forEach(function (w, i) {
      if (w.ph !== lastPh) {
        lastPh = w.ph;
        html += '<div class="phlabel" style="color:' + PH[w.ph].color + '">' + PH[w.ph].nm.toUpperCase() + '<span class="pl-line" style="background:' + PH[w.ph].color + '33"></span></div>';
      }
      html += '<div class="wkrow' + (w.cur ? ' cur' : '') + '" data-wk="' + i + '">'
        + '<span class="wn">' + w.n + '</span>'
        + '<span class="wbar"><i style="width:' + Math.round((w.mi / MAXMI) * 100) + '%;background:' + PH[w.ph].color + '"></i></span>'
        + '<span class="wkey">' + w.key + '</span>'
        + '<span class="wmi">' + w.mi + ' mi</span>'
        + '</div>';
    });
    html += '<div class="phlabel" style="color:var(--gold)">RACE<span class="pl-line" style="background:#FFCE8A33"></span></div>'
      + '<div class="wkrow race"><span class="wn">★</span><span class="wkey">' + RACE.nm + ' · ' + RACE.goal + '</span><span class="wmi">' + RACE.mi + '</span></div>';
    return html;
  }

  /* ---------- lower region per direction ---------- */
  function buildLower(variant) {
    var lo = $('lower');
    lo.className = 'lower ' + variant;
    if (variant === 'A') {
      lo.innerHTML = mPhases()
        + '<div class="arow">' + mThisWeek(false) + mProjection() + mMilestones() + '</div>';
    } else if (variant === 'B') {
      lo.innerHTML = mThisWeek(true)
        + '<div class="rail">' + mProjection() + mMilestones() + '</div>';
    } else {
      lo.innerHTML = mThisWeek(true)
        + '<div class="card allweeks"><div class="ch"><span class="ct">FULL PLAN · 13 WEEKS TO RACE</span>' + fullPlanBtn() + '</div>'
        + '<div class="weeklist">' + mWeekList() + '</div></div>';
    }
    lo.querySelectorAll('.wkrow[data-wk]').forEach(function (r) {
      r.addEventListener('click', function () { focusWeek(+r.dataset.wk); });
    });
    lo.querySelectorAll('[data-openplan]').forEach(function (b) {
      b.addEventListener('click', function () { openModal(variant === 'C' ? 'month' : 'weeks'); });
    });
  }

  /* ---------- modal: month calendar + weeks list ---------- */
  function buildCalendar() {
    var months = [ { y:2026, m:5, nm:'June 2026' }, { y:2026, m:6, nm:'July 2026' }, { y:2026, m:7, nm:'August 2026' } ];
    var DOW = ['M','T','W','T','F','S','S'];
    var WK = {
      1:{ t:'easy',      nm:'Easy',      mi:'6.5', pace:'8:12' },
      2:{ t:'threshold', nm:'Threshold', mi:'7.5', pace:'6:47', det:'3×2mi blocks' },
      3:{ t:'easy',      nm:'Easy',      mi:'6.5', pace:'8:12' },
      4:{ t:'intervals', nm:'Intervals', mi:'6.0', pace:'6:05', det:'8×600m' },
      5:{ t:'easy',      nm:'Easy',      mi:'6.5', pace:'8:12' },
      6:{ t:'rest',      nm:'Rest' },
      0:{ t:'long',      nm:'Long',      mi:'12',  pace:'8:00', det:'HM finish' },
    };
    var tint = function (c) { return 'background:color-mix(in srgb,' + c + ' 22%,transparent);color:' + c; };
    var today = new Date(2026, 5, 16);
    var out = '';
    months.forEach(function (mo) {
      var first = new Date(mo.y, mo.m, 1);
      var lead = (first.getDay() + 6) % 7;
      var days = new Date(mo.y, mo.m + 1, 0).getDate();
      var cells = '';
      DOW.forEach(function (d) { cells += '<div class="cal-dow">' + d + '</div>'; });
      for (var i = 0; i < lead; i++) cells += '<div class="cell empty"></div>';
      for (var dd = 1; dd <= days; dd++) {
        var date = new Date(mo.y, mo.m, dd);
        var dow = date.getDay();
        var isRace = (dd === 15 && mo.m === 7);
        var isToday = (date.getTime() === today.getTime());
        var past = date < today && !isToday;
        var w = WK[dow];
        var cls = 'cell' + (isToday ? ' today' : '') + (isRace ? ' race' : '') + (past ? ' past' : '');
        var inner = '<div class="cd">' + dd + '</div>';
        if (isRace) {
          inner += '<div class="cwk"><span class="ctag" style="' + tint('#FFCE8A') + '">Race</span>'
            + '<div class="cmeta">Half<small> · 13.1 mi</small></div><div class="cdet">Sub 1:30:00</div></div>';
        } else if (w.t === 'rest') {
          inner += '<span class="crest">Rest day</span>';
        } else {
          var c = TYPE[w.t];
          inner += '<div class="cwk"><span class="ctag" style="' + tint(c) + '">' + w.nm + '</span>'
            + '<div class="cmeta">' + w.mi + '<small> mi · ' + w.pace + '</small></div>'
            + (w.det ? '<div class="cdet">' + w.det + '</div>' : '') + '</div>';
        }
        cells += '<div class="' + cls + '">' + inner + '</div>';
      }
      out += '<div class="calmonth"><div class="cm-h">' + mo.nm + '</div><div class="cal-grid">' + cells + '</div></div>';
    });
    var legend = '<div class="cal-legend">'
      + '<div class="lg"><i style="background:' + TYPE.easy + '"></i>Easy</div>'
      + '<div class="lg"><i style="background:' + TYPE.tempo + '"></i>Threshold</div>'
      + '<div class="lg"><i style="background:' + TYPE.intervals + '"></i>Intervals</div>'
      + '<div class="lg"><i style="background:' + TYPE.long + '"></i>Long</div>'
      + '<div class="lg"><i style="background:' + TYPE.rest + '"></i>Rest</div>'
      + '<div class="lg"><i style="background:' + TYPE.race + '"></i>Race</div></div>';
    return '<div class="cal">' + out + legend + '</div>';
  }

  function openModal(tab) {
    $('planOv').classList.add('open');
    setModalTab(tab || 'month');
  }
  function closeModal() { $('planOv').classList.remove('open'); }
  function setModalTab(tab) {
    $('segMonth').classList.toggle('on', tab === 'month');
    $('segWeeks').classList.toggle('on', tab === 'weeks');
    if (tab === 'month') {
      $('modalBody').innerHTML = buildCalendar();
    } else {
      $('modalBody').innerHTML = '<div class="mweeks">' + mWeekList() + '</div>';
      $('modalBody').querySelectorAll('.wkrow[data-wk]').forEach(function (r) {
        r.addEventListener('click', function () { focusWeek(+r.dataset.wk); closeModal(); });
      });
    }
  }

  /* ---------- wiring ---------- */
  function init() {
    renderRamp();
    focusWeek(CUR);
    buildLower('A');

    document.querySelectorAll('.switch button[data-v]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.switch button[data-v]').forEach(function (x) { x.classList.toggle('on', x === b); });
        $('swSub').textContent = b.dataset.sub;
        buildLower(b.dataset.v);
      });
    });

    $('segMonth').addEventListener('click', function () { setModalTab('month'); });
    $('segWeeks').addEventListener('click', function () { setModalTab('weeks'); });
    $('sheetX').addEventListener('click', closeModal);
    $('planOv').addEventListener('click', function (e) { if (e.target === $('planOv')) closeModal(); });
    $('openPlanTop').addEventListener('click', function () { openModal('month'); });

    // fit
    var fit = $('fit');
    function scale() {
      var s = Math.min((window.innerWidth - 48) / 1600, (window.innerHeight - 96) / 1080, 1);
      fit.style.transform = 'scale(' + s + ')';
    }
    scale(); window.addEventListener('resize', scale);
  }
  document.addEventListener('DOMContentLoaded', init);
})();
