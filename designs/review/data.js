/* Shared Big Sur course data + math utilities for lab demos.
   Every preview pulls from this so comparisons are apples-to-apples. */

(function(){
  'use strict';

  // Big Sur waypoints: lat, lon, ele(m) along the marathon course.
  // Rough shape (coastal run south→north with Hurricane Point climb ~mi 10-12).
  var WAYPOINTS = [
    { lat:36.2520, lon:-121.7790, ele: 20 },   // Start - Big Sur Station
    { lat:36.2700, lon:-121.7900, ele: 15 },
    { lat:36.2900, lon:-121.8050, ele: 35 },
    { lat:36.3100, lon:-121.8200, ele: 60 },
    { lat:36.3300, lon:-121.8400, ele: 25 },
    { lat:36.3500, lon:-121.8600, ele: 48 },
    { lat:36.3650, lon:-121.8800, ele: 80 },
    { lat:36.3726, lon:-121.9031, ele: 173 },  // Hurricane Point (peak)
    { lat:36.3900, lon:-121.9050, ele: 120 },
    { lat:36.4100, lon:-121.9080, ele: 75 },
    { lat:36.4300, lon:-121.9100, ele: 55 },
    { lat:36.4500, lon:-121.9130, ele: 90 },
    { lat:36.4700, lon:-121.9160, ele: 40 },
    { lat:36.4900, lon:-121.9190, ele: 65 },
    { lat:36.5100, lon:-121.9200, ele: 30 },
    { lat:36.5300, lon:-121.9220, ele: 55 },
    { lat:36.5552, lon:-121.9233, ele: 12 }    // Finish - Carmel
  ];

  // --- Projection to canvas -----------------------------------------------
  // PCA rotate route so principal axis is horizontal, then fit to W/H box
  // with padded margins. Returns { pts: [{x,y}], scale, offX, offY }.
  function project(pts, W, H, pad){
    pad = pad || { l:60, r:60, t:50, b:50 };
    var latC = 0; pts.forEach(function(p){ latC += p.lat; }); latC /= pts.length;
    var kx = Math.cos(latC * Math.PI/180);
    var raw = pts.map(function(p){ return { x: p.lon*kx, y: p.lat }; });
    var cx=0, cy=0; raw.forEach(function(p){ cx+=p.x; cy+=p.y; });
    cx/=raw.length; cy/=raw.length;
    raw.forEach(function(p){ p.x-=cx; p.y-=cy; });
    var sxx=0,syy=0,sxy=0;
    raw.forEach(function(p){ sxx+=p.x*p.x; syy+=p.y*p.y; sxy+=p.x*p.y; });
    var theta = 0.5 * Math.atan2(2*sxy, sxx-syy);
    var c=Math.cos(-theta), s=Math.sin(-theta);
    var rot = raw.map(function(p){ return { x:p.x*c - p.y*s, y:p.x*s + p.y*c }; });
    if (rot[0].x > rot[rot.length-1].x){
      rot.forEach(function(p){ p.x = -p.x; });
    }
    var minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    rot.forEach(function(p){
      if (p.x<minX)minX=p.x; if (p.x>maxX)maxX=p.x;
      if (p.y<minY)minY=p.y; if (p.y>maxY)maxY=p.y;
    });
    var spanX=maxX-minX||1e-9, spanY=maxY-minY||1e-9;
    var availW = W - pad.l - pad.r, availH = H - pad.t - pad.b;
    var scale = Math.min(availW/spanX, availH/spanY);
    var offX = pad.l + (availW - spanX*scale)/2;
    var offY = pad.t + (availH - spanY*scale)/2;
    return rot.map(function(p){
      return { x: offX + (p.x-minX)*scale, y: offY + (maxY-p.y)*scale };
    });
  }

  // Densify waypoint list with cosine-interpolated intermediates so the route
  // has enough points to render smooth curves + elevation profile.
  function densify(waypts, nPer){
    nPer = nPer || 24;
    var out = [];
    var cumMi = [0];
    for (var i=0;i<waypts.length-1;i++){
      var a = waypts[i], b = waypts[i+1];
      cumMi.push(cumMi[i] + haversine(a,b));
    }
    var total = cumMi[cumMi.length-1];
    for (var i=0;i<waypts.length-1;i++){
      var a = waypts[i], b = waypts[i+1];
      for (var k=0;k<nPer;k++){
        var t = k/nPer;
        // cosine-smooth elevation to avoid cusps at waypoints
        var tE = 0.5 - 0.5*Math.cos(Math.PI*t);
        // tiny sinusoidal wiggle on position for organic feel
        var jx = Math.sin(t*Math.PI*2 + i*1.3) * 0.0005;
        var jy = Math.cos(t*Math.PI*2.5 + i*0.9) * 0.0005;
        out.push({
          lat: a.lat + (b.lat-a.lat)*t + jy,
          lon: a.lon + (b.lon-a.lon)*t + jx,
          ele: a.ele + (b.ele-a.ele)*tE
        });
      }
    }
    out.push(waypts[waypts.length-1]);
    return out;
  }

  function haversine(a,b){
    var R = 3958.8, toR = Math.PI/180;
    var dLat = (b.lat-a.lat)*toR, dLon = (b.lon-a.lon)*toR;
    var la1 = a.lat*toR, la2 = b.lat*toR;
    var h = Math.sin(dLat/2)*Math.sin(dLat/2) +
            Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)*Math.sin(dLon/2);
    return 2*R*Math.asin(Math.sqrt(h));
  }

  function buildSeries(pts){
    var M = 3.28084;
    var elevFt = pts.map(function(p){ return p.ele*M; });
    var cum = [0];
    for (var i=1;i<pts.length;i++) cum.push(cum[i-1] + haversine(pts[i-1], pts[i]));
    return { pts: pts, cum: cum, elevFt: elevFt };
  }

  // Catmull-Rom → cubic Bézier path
  function smoothPath(pts){
    if (pts.length < 2) return '';
    var d = 'M ' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1);
    for (var i=0;i<pts.length-1;i++){
      var p0 = pts[i-1]||pts[i], p1 = pts[i], p2 = pts[i+1], p3 = pts[i+2]||pts[i+1];
      var c1x = p1.x + (p2.x - p0.x)/6, c1y = p1.y + (p2.y - p0.y)/6;
      var c2x = p2.x - (p3.x - p1.x)/6, c2y = p2.y - (p3.y - p1.y)/6;
      d += ' C '+c1x.toFixed(1)+' '+c1y.toFixed(1)+', '+
               c2x.toFixed(1)+' '+c2y.toFixed(1)+', '+
               p2.x.toFixed(1)+' '+p2.y.toFixed(1);
    }
    return d;
  }

  // Locate a (x,y) point at cumulative-mile `mi` along the projected path
  function pointAtMi(proj, cum, mi){
    var total = cum[cum.length-1];
    var target = Math.min(Math.max(mi, 0), total);
    var lo=0, hi=cum.length-1;
    while (lo < hi-1){ var m=(lo+hi)>>1; if (cum[m] < target) lo=m; else hi=m; }
    var span = cum[hi]-cum[lo] || 1e-9, t = (target-cum[lo])/span;
    return {
      x: proj[lo].x + (proj[hi].x-proj[lo].x)*t,
      y: proj[lo].y + (proj[hi].y-proj[lo].y)*t
    };
  }

  // Common phase palette (5 stops)
  var PHASES = [
    { pct:0.22, color:'#3EBD41', name:'Opening' },
    { pct:0.42, color:'#F3AD3B', name:'Climb'   },
    { pct:0.62, color:'#FC4D54', name:'Peak'    },
    { pct:0.82, color:'#008FEC', name:'Cruise'  },
    { pct:1.01, color:'#9013FE', name:'Finish'  }
  ];

  // Default waypoint list for rendering (start, peak, mi 20, finish)
  var LANDMARKS = [
    { mi:0,    label:'START',           major:'start'  },
    { mi:10.6, label:'PEAK · 568 FT',   major:'peak'   },
    { mi:20,   label:'MI 20',           major:'minor'  },
    { mi:26.2, label:'FINISH',          major:'finish' }
  ];

  window.LAB = {
    WAYPOINTS: WAYPOINTS,
    PHASES: PHASES,
    LANDMARKS: LANDMARKS,
    project: project,
    densify: densify,
    haversine: haversine,
    buildSeries: buildSeries,
    smoothPath: smoothPath,
    pointAtMi: pointAtMi
  };
})();
