#!/usr/bin/env python3
import base64, os, html, json

FACES = "/tmp/faces"
def uri(p):
    with open(p,"rb") as f:
        return "data:image/png;base64," + base64.b64encode(f.read()).decode()

def board(name, cap, sub=None, dirp=FACES):
    p = f"{dirp}/{name}.png"
    if not os.path.exists(p): return ""
    s = f'<figure class="b"><img src="{uri(p)}" alt="{html.escape(cap)}" loading="lazy">'
    s += f'<figcaption><b>{html.escape(cap)}</b>'
    if sub: s += f'<span>{html.escape(sub)}</span>'
    s += '</figcaption></figure>'
    return s

FAM = [
 ("Page 1 — the primary face",
  "Pace, heart, distance, time. One left edge. The band under the pace is the answer to <em>what speed should I be doing</em> — colour alone says you are wrong without saying what right was.",
  [("p1","On target","band lit green, mark inside it"),
   ("p1drift","Drifting","lit segment goes white the moment the mark leaves it, so the strip can never show two greens"),
   ("p1nohr","No heart signal","the failure is one slot, not one screen — every other number keeps its size and position"),
   ("p1tread","Treadmill","nothing grades on a belt: no trustworthy pace, so no colour and no gauge"),
   ("p1free","Steady run, no band","pace is measured, not graded"),
   ("p1ugly","Worst case in every slot","10:59 · 204 · 100.0 · 5:59:59")]),
 ("Page 2 and Always-On", None,
  [("p2","Performance","cadence, average pace, power, climb"),
   ("p2min","Power and climb absent","the board becomes two metrics; it never draws a dash, because a dash claims the slot works"),
   ("alwayson","Wrist down","three values, no ticking second — and no band: a stale mark is a more confident lie than a stale number")]),
 ("The six structured phases",
  "No phase name on any of them. The name is announced by the phase-change moment and then not repeated — see <em>Moments</em> below.",
  [("warmup","Warm-up","no band prescribed, so the pace is white"),
   ("work","Work interval","band on row 1, drifting"),
   ("recovery","Recovery","no pace at all — a recovery is not asking for one, and drawing it invites racing the recovery"),
   ("strides","Strides","cadence, not pace: over twenty seconds a GPS pace is mostly lag"),
   ("threshold","Threshold","the board you approved, plus average pace"),
   ("race","Race","graded metric is row 0 here, not row 1 — the band row is derived, never a constant"),
   ("raceugly","Race, late and behind","+12:47 against goal, 4:38:02 elapsed")]),
 ("One to four metrics",
  "Task 2 of the foundation brief, on the final shell, at deliberately ugly widths. Round numbers hide width bugs — the size collapse survived a twelve-cell matrix because every cell in it was short.",
  [("m1","One","width binds long before the per-count ceiling"),
   ("m2","Two","group centred, pitch opened up because there is slack"),
   ("m3","Three",None),("m4","Four",None),
   ("m4band","Four with a band","the band reserves its own height so it cannot land on the row below")]),
 ("Controls", "Reached by tapping the running face. Three verbs and no telemetry: the runner came here to do something, not to read.",
  [("controls","Steady run","header says where you are"),
   ("controlsrep","Inside a rep","Lap becomes Skip rep in the same slot, and the header names the rep — Skip without it is a question you cannot answer"),
   ("endconfirm","End confirm","what is unfinished stated as a fact; Discard is text at 42%, never a second filled pill"),
   ("endconfirmclean","Nothing unfinished","the line drops rather than finding something to say"),
   ("skipconfirm","Skip confirm","the one confirmation that earns a coach sentence, then honours either answer with no second ask"),
   ("extend","Extend recovery","lives on the recovery face because it is only true for ninety seconds")]),
 ("Faults", "No sensor blocks the run. Start stays pressable on every one of these.",
  [("gps","No fix yet","amber, not red — nothing has failed"),
   ("battery","Low battery","one sensor called one name: the sentence says GPS, the button says Drop GPS"),
   ("batterynoest","No projection available","the clause is dropped, not guessed"),
   ("waterlock","Water lock","the run keeps recording, so the board proves it with two moving numbers")]),
 ("The coach asks", None,
  [("bail","The bail, offered","evidence quietly first, then the judgement; the only shape that waits rather than giving the screen back"),
   ("ceiling","Ceiling breach",None),
   ("ceilingoverride","Lift it for today","takes an answer instead of stating an unanswerable limit"),
   ("spokencue","The spoken cue, drawn","a spoken cue is always also drawn — audio is a delivery route, never a second channel")]),
 ("Moments", "Two or three seconds behind a haptic, then the screen goes back. A moment reduces density, never adds it.",
  [("mgo","Go",None),
   ("mphase","Phase change","<b>this</b> is where the phase is named, and why the steady-state board does not repeat it"),
   ("msplit","Split",None),
   ("mfuel","Fuel","race only, and the one moment with a colour field: at mile 14 a lit panel is what gets seen"),
   ("measeoff","Ease off","says the band in words, so it is actionable"),
   ("mquicken","Pick it up",None),
   ("mpaused","Paused",None)]),
 ("Lobby", "The one place colour fills a screen. Start sits at the same height on every variant so the thumb target never moves between sessions.",
  [("lobbyeasy","Easy · 4 characters","lede at 36pt"),
   ("lobbylong","Long · qualifier line",None),
   ("lobbythreshold","Threshold · 9 characters","lede steps down to 22pt, dose takes two lines"),
   ("lobbyintervals","Intervals · densest",None),
   ("lobbyrace","Race morning","the goal replaces the band and earns a third register"),
   ("lobbymoved","The session already moved","stated once as a fact, never as a score to argue with at 6am"),
   ("restday","Rest day","a refusal with a reason, not an empty state"),
   ("lobbyplan","Page 2 · the race plan",None),
   ("lobbysteps","Page 2 · the steps","the row the session is about carries the fill"),
   ("lobbyweek","Page 3 · this week","load, not seven rows of text")]),
 ("Finish and first run", None,
  [("complete","Complete",None),
   ("racecomplete","Race day","provisional chip time in amber; this hands off to the phone"),
   ("summary","Summary","the only scrolling board, so the only one allowed more than four numbers"),
   ("firstlaunch","Before there is a plan",None)]),
 ("Notifications", "One shell: source line, the change as the lede, the consequence in the coach's register, and a target only when there genuinely is one.",
  [("notifmoved","Session moved","no action — and giving it one would make it a thing to dismiss rather than read"),
   ("notifmovedlong","Longer lede",None),
   ("notifrace","Race tomorrow",None),
   ("notifunread","Yesterday is unread","one target, amber kicker, fires once — a second reminder would be a nag"),
   ("notifunreadsent","As sent",None)]),
]

DEFECTS = [
 ("The band existed only in my screenshots",
  "<code>PhaseFaceV6</code> and <code>RunFaceV6</code> both accept a band and the router passed neither. Every running face coloured the pace and none said what it was being coloured against. It survived review because the preview harness supplied a band by hand — the screenshots were accurate about a screen that did not exist.",
  "The harness now carries a rule: a fixture may only supply what the router supplies."),
 ("Every number was 22% smaller than it could be",
  "The width model billed each glyph at a flat 0.66 of the point size. A colon is about half a digit and a clock is a third colons, so <code>5:59:59</code> was charged 176pt of a 178pt line when it actually draws in 124. Width bound before height on every four-metric board and the type came out at 37pt where 46 fits.",
  "Found by measuring the ink in a screenshot. The arithmetic was self-consistent; re-reading it would never have shown this. Widths are measured with CoreText now, not modelled."),
 ("One column at three sizes",
  "The no-heart-signal board built three separate stacks that each sized themselves, so the pace rendered visibly larger than the distance below it.",
  "Only visible on a contact sheet beside its siblings — which is why every family is now reviewed as a sheet, never one board at a time."),
 ("The lobby was only full-bleed when the copy ran long",
  "<code>ignoresSafeArea</code> extends a view past the safe area; it does not make it fill its parent. The board sized to its content, so the easy lobby stopped at 204pt of 248 and left 44pt of black under Start, while the threshold lobby filled correctly because its copy happens to be taller.",
  "The truncated dose on two lobbies was the same bug wearing a different face — it read as a copy problem and was a layout one."),
 ("Content sat on the system clock",
  "Apple's content box starts at y=18 and the clock inks at y=20–34, so any board leading with display type drew it level with the time. End confirm put END RUN on the clock's own baseline.",
  "Small-caps kickers beside the clock are a normal watchOS pattern and stay. The design's rule 5 said &ldquo;the top 22pt is empty&rdquo;; 22 was measured off the design file's shell, 36 is measured off the device."),
 ("The notification lede drew at half size",
  "<code>.leading(.tight)</code> was added to buy the design's line-height:.92 on a wrapped lede. It cost 12pt of type instead: with it, SESSION MOVED collapses onto one line at an 8pt cap height — under half the specified 23pt, and smaller than the sentence beneath it.",
  "Found by bisection, one modifier at a time. The file's own comment already said shrinking was the wrong answer; the modifier just never learned about the line limit."),
 ("The two newest watches got another watch's screen size",
  "<code>WatchLayout</code> keyed on screen height and returned the nearest table row verbatim. Both current watches are near matches, not exact: the Series 11 42mm is 187×223 against the kit's 184×224, the Ultra 3 is 211×257 against the Ultra 2's 205×251. So the ramp stopped 3pt short of the bezels on both.",
  "Only found by rendering on all three sizes."),
 ("I was building the wrong Xcode project",
  "The render harness pointed at <code>legacy/native/Faff/Faff.xcodeproj</code>. That project has no widget target and no <code>project.yml</code>, so it cannot compile the watch app at all. The watch ships from <code>native-v2</code>, which symlinks both watch folders in.",
  "Same defect as judging a stale binary, one level up: verifying the wrong artefact rather than an old one."),
 ("The geometry check cried wolf on eleven correct boards",
  "It measured raw luminance, so a lobby's own ramp counted as content and every full-bleed board reported as overflowing on all four sides.",
  "A check that fires on the boards that are right teaches you to ignore it. It isolates type with a high pass now — glyphs are high-frequency, a ramp is not."),
]

DECISIONS = [
 ("Equal metric sizes, or a 20% hero?",
  "The design's rule 4 says &ldquo;the metric that matters is first and ~20% larger than the next, so the hierarchy survives a runner who cannot distinguish the two hues.&rdquo; You asked for the opposite — <em>&ldquo;I wish 6:31 could be the same size as the other numbers and everything was consistent&rdquo;</em> — and every board here is built equal-size.",
  "I read your note as removing an accidental inconsistency, and applied it as a rule. If you meant only that one row, the hero step comes back and this is a one-line change."),
 ("The minus sign on the race board",
  "<code>−0:22</code> means twenty-two seconds ahead of goal, with <code>sub 3:30</code> at the foot. There is no unit, because &ldquo;on goal&rdquo; is seven characters and a long word beside a figure is a label — and it would have set the type size for all four rows.",
  "The sign convention is standard for race splits, but it is the one number here whose meaning rests on a convention rather than on its own face."),
 ("Green for &ldquo;today&rdquo; on the week strip",
  "Rule 1 says green means the pace is inside the band and nothing else on the app is coloured. The week strip lights today's bar green, which is a second meaning for the same colour.",
  "It is not a number, so it does not read as a graded figure — but it does spend the strongest signal in the app on a position marker."),
 ("The phase name is gone from the steady-state boards",
  "The design's §3 says each phase board &ldquo;names the phase, the count, and the target band.&rdquo; You removed the name. The count and band stayed.",
  "Worth knowing that the name is still announced — the phase-change moment says WORK in the display register at the transition, then the board underneath never repeats it."),
]

GAPS = [
 ("The summary board's last row", "It ends on a 1–2pt hairline of the next row's fill at the very bottom edge, where the design asks for a whole row. That is exactly where the corner mask is not in the framebuffer, so it needs looking at on a real watch before it is worth chasing in code."),
 ("The controls board is not Apple's Three Bottom Controls", "It is three stacked full-width pills. Apple's arrangement is two 35pt round slots and one 46pt centre slot, which take icons, not the words Lap / Pause / End run. Real design question, not an oversight — flagging rather than deciding."),
 ("Device-only checks", "Corner clipping at the bottom margin, running power on a belt, water lock, haptic textures, and Always-On rendering all need a real watch. The simulator does not draw the corner mask, so a screenshot can never settle edge fit."),
 ("The review harness is still mounted", "<code>_FacePreview.swift</code> and its mount in <code>WorkoutRootView</code> are what let you see any board on demand. They come out before ship — left in so you can drive this yourself tomorrow."),
 ("Complications and the Smart Stack widget", "Not rebuilt in this pass. They live in a separate target and are the last surface still on the old layout."),
]

SIZES = [("42","threshold"),("46","threshold"),("49","threshold"),
         ("42","controls"),("46","controls"),("49","controls"),
         ("42","lobbythreshold"),("46","lobbythreshold"),("49","lobbythreshold")]

def size_img(sz,name):
    d = FACES if sz=="46" else f"{FACES}/{sz}"
    p=f"{d}/{name}.png"
    if not os.path.exists(p): return ""
    return f'<figure class="b"><img src="{uri(p)}" alt="{sz}mm {name}" loading="lazy"><figcaption><b>{sz}mm</b><span>{name}</span></figcaption></figure>'

out=[]
out.append('<title>Faff Watch Boards</title>')
out.append('''<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;800&family=Instrument+Sans:wght@400;500;600&display=swap">''')
out.append('''<style>
:root{
  --ground:#08090A; --surface:#121416; --surface2:#1B1E21; --line:#24282C;
  --ink:#ECEDEE; --ink2:#A8AEB4; --ink3:#767C82;
  --band:#3EBD41; --attention:#F2B03C; --fault:#FF4438; --signal:#FF5A1F;
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);
  font-family:"Instrument Sans",system-ui,-apple-system,sans-serif;
  font-size:16px;line-height:1.55;-webkit-font-smoothing:antialiased}
.wrap{max-width:1120px;margin:0 auto;padding:0 24px 120px}
header.top{padding:72px 0 40px;border-bottom:1px solid var(--line);margin-bottom:44px}
h1{font-family:Archivo,sans-serif;font-weight:800;font-stretch:112%;
  font-size:clamp(34px,6vw,60px);line-height:.98;letter-spacing:-.02em;margin:0 0 18px;
  text-transform:uppercase;text-wrap:balance}
h1 .dot{color:var(--signal)}
.lede{font-size:19px;color:var(--ink2);max-width:62ch;margin:0}
.meta{margin-top:26px;display:flex;flex-wrap:wrap;gap:8px}
.chip{font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;font-weight:600;
  padding:5px 11px;border-radius:999px;background:var(--surface2);color:var(--ink2)}
h2{font-family:Archivo,sans-serif;font-weight:800;font-stretch:112%;text-transform:uppercase;
  font-size:clamp(22px,3vw,30px);letter-spacing:-.01em;margin:64px 0 6px;text-wrap:balance}
h2:first-of-type{margin-top:0}
h3{font-family:Archivo,sans-serif;font-weight:600;font-size:18px;margin:0 0 6px;letter-spacing:-.005em}
.sec-note{color:var(--ink2);max-width:70ch;margin:0 0 26px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:26px 20px;margin:8px 0 12px}
.b{margin:0}
.b img{width:100%;height:auto;display:block;border-radius:22px;background:#000}
.b figcaption{margin-top:9px;font-size:13.5px;line-height:1.42;color:var(--ink3)}
.b figcaption b{display:block;color:var(--ink);font-weight:600;font-size:14px}
.b figcaption span{display:block;margin-top:2px}
.cards{display:grid;gap:14px;margin:22px 0 0}
.card{background:var(--surface);border-radius:14px;padding:20px 22px}
.card p{margin:8px 0 0;color:var(--ink2);font-size:15px}
.card .how{margin-top:12px;padding-top:12px;border-top:1px solid var(--line);
  color:var(--ink3);font-size:14px}
.card.ask{background:var(--surface);box-shadow:inset 3px 0 0 var(--attention)}
.card.gap{background:var(--surface);box-shadow:inset 3px 0 0 var(--ink3)}
.card.bug{background:var(--surface);box-shadow:inset 3px 0 0 var(--fault)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.88em;
  background:var(--surface2);padding:1px 5px;border-radius:4px;color:var(--ink)}
.how code{background:#1F2327}
em{color:var(--ink);font-style:italic}
.toc{display:flex;flex-wrap:wrap;gap:7px;margin:26px 0 0}
.toc a{font-size:13.5px;color:var(--ink2);text-decoration:none;background:var(--surface);
  padding:6px 12px;border-radius:8px;border:1px solid transparent}
.toc a:hover,.toc a:focus-visible{color:var(--ink);border-color:var(--line);outline:none}
.run{background:var(--surface);border-radius:14px;padding:18px 22px;margin-top:16px;
  overflow-x:auto}
.run pre{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13.5px;
  color:var(--ink2);white-space:pre}
footer{margin-top:80px;padding-top:26px;border-top:1px solid var(--line);
  color:var(--ink3);font-size:14px}
@media (prefers-reduced-motion:no-preference){.b img{transition:transform .15s ease}
 .b:hover img{transform:scale(1.015)}}
</style>''')

out.append('<div class="wrap"><header class="top">')
out.append('<h1>Watch faces<span class="dot">.</span> Every board</h1>')
out.append('<p class="lede">Sixty boards on the native foundation, each one rendered on a real simulator and checked against Apple’s own layout guides. Nine defects are written up below — six of them looked correct in a screenshot, which is the part worth reading.</p>')
out.append('<div class="meta"><span class="chip">60 boards</span><span class="chip">3 watch sizes</span><span class="chip">9 defects fixed</span><span class="chip">4 decisions for you</span></div>')
import re as _re
def slug(t):
    return _re.sub(r"[^a-z0-9]+","-", t.lower().split("—")[0].strip()).strip("-")
out.append('<nav class="toc"><a href="#found">What I found</a><a href="#decisions">Your call</a>')
for t,_,_ in FAM: out.append(f'<a href="#{slug(t)}">{html.escape(t.split(" —")[0])}</a>')
out.append('<a href="#sizes">Three sizes</a><a href="#gaps">Not done</a></nav>')
out.append('</header>')

out.append('<h2 id="found">What I found</h2>')
out.append('<p class="sec-note">Ordered by how well each one was hiding. The pattern across all nine is the same: the check passed, and the check was not looking at the thing that mattered.</p><div class="cards">')
for t,body,how in DEFECTS:
    out.append(f'<div class="card bug"><h3>{t}</h3><p>{body}</p><p class="how">{how}</p></div>')
out.append('</div>')

out.append('<h2 id="decisions">Four things that are your call</h2>')
out.append('<p class="sec-note">Each of these is a place where the design file and a ruling of yours disagree, or where I picked a convention you have not seen. I have built the version I think is right and flagged it rather than quietly choosing.</p><div class="cards">')
for t,body,how in DECISIONS:
    out.append(f'<div class="card ask"><h3>{t}</h3><p>{body}</p><p class="how">{how}</p></div>')
out.append('</div>')

for t,note,items in FAM:
    anc=slug(t)
    out.append(f'<h2 id="{anc}">{html.escape(t)}</h2>')
    if note: out.append(f'<p class="sec-note">{note}</p>')
    out.append('<div class="grid">')
    for it in items:
        n,c,s = it
        out.append(board(n,c,s))
    out.append('</div>')

out.append('<h2 id="sizes">The same design on three watches</h2>')
out.append('<p class="sec-note">Not one layout scaled. Apple’s margins are a thumb-and-bezel measurement, so they stay put and the content region changes around them. Shown at matched height, so the physical size difference is the real one.</p><div class="grid">')
for sz,n in SIZES: out.append(size_img(sz,n))
out.append('</div>')

out.append('<h2 id="gaps">What is not done</h2><div class="cards">')
for t,b in GAPS:
    out.append(f'<div class="card gap"><h3>{t}</h3><p>{b}</p></div>')
out.append('</div>')

out.append('<h2>Driving it yourself</h2>')
out.append('<p class="sec-note">Any board, on any booted watch simulator. The script regenerates the project, builds to a known path, and refuses to install if a source file is newer than the binary — so a screenshot can never be of a stale build.</p>')
out.append('<div class="run"><pre>./scripts/watch/shoot.sh threshold race lobbyeasy\nSIM=&lt;49mm-udid&gt; OUT=/tmp/faces/49 ./scripts/watch/shoot.sh threshold\npython3 scripts/watch/sheet.py /tmp/sheet.png p1 p1drift p1nohr p1ugly\npython3 scripts/watch/geom.py /tmp/faces/*.png</pre></div>')

out.append('<footer>Rendered on Apple Watch Series 11 46mm, Series 11 42mm and Ultra 3, watchOS 26.5. The build standard every board was held to is in <code>docs/design/watch-0821/FACE-QC.md</code> — twenty rules, each one a defect that shipped.</footer>')
out.append('</div>')

path="/private/tmp/claude-501/-Volumes-WP-06-Claude-Code-Runcino/cf5ff431-35ce-4345-9411-6e8de275d3c8/scratchpad/watch-faces.html"
open(path,"w").write("\n".join(out))
print(path, f"{os.path.getsize(path)/1e6:.1f} MB")
