
// ---------- club view ----------
// Turns a genome into sound and UI: the audio engine (drum/tone and the instrument engines),
// the 16-step scheduler (sched/tick), the canvases (spectrum, search chart, arrangement),
// the search controller (onBar/stepSearch), and the MIDI export of the 72-bar track.
// Reads from js/genome.js: LAYERS, STYLES, KIT, SYN, LIB and the helpers
// (makeGenome, makePlan, renderBar, runAll, rngFrom, F0, voicing, bassMidi, arpNote, semi).
// Everything it owns lives inside this closure; window.__bl at the bottom is the outside handle.
(function(){
'use strict';
const $=id=>document.getElementById(id);
const el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e};
const rootCss=getComputedStyle(document.documentElement);
const COL={};LAYERS.forEach(L=>{COL[L.id]=[rootCss.getPropertyValue('--'+L.id).trim()||'#b9a7ff',rootCss.getPropertyValue('--'+L.id+'-d').trim()||'#5a3fd0']});
const SRC={butler:'Butler 2006',toussaint:'Toussaint 2005',witek:'Witek et al. 2014',krumhansl:'Krumhansl & Kessler 1982',tymoczko:'Tymoczko 2011',huron:'Huron 2001',plomp:'Plomp & Levelt 1965',caplin:'Caplin 1998'};
const HOME={roots:[0,0,0,0],inv:[0,0,0,0]};
const BSEM=[0,7,12,3.5];
const EMPTY={bi:0,v:{},pd:null,bass:null,lead:null,chordHit:null,pad:null,arp:null,gapFrom:16};
const reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// loudness: LEVEL sets each part's place in the mix; TRIM evens out the instruments inside a part. Both come from offline measurements.
const LEVEL=/*LEVEL*/{kick:1,clap:.58,hat:.26,ohat:.2,perc:.3,bass:.3,chords:.26,pad:.12,arp:.12,lead:.25}/*END*/;
const TRIM=/*TRIM*/{"kick":{"808":0.84,"909":1.03,"House":0.97,"Punch":1.09,"Hard":0.93,"Rumble":0.93,"Trance":1.07,"Psy":1.19,"Deep":0.78,"Slam":0.88,"Click":1.34},"clap":{"Clap 909":1.25,"Clap 808":1.49,"Snare":0.55,"Rim":0.83,"Snap":1.8,"Layered":0.72,"Clap Deep":1.26,"Brush":1.19},"hat":{"808":1.36,"909":1.0,"Shaker":0.57,"Tight":0.55,"Tambourine":1.0,"Crisp":1.3,"Metal":0.75},"ohat":{"808":1.11,"909":1.13,"Sizzle":0.55,"Ride":0.91,"Long 909":0.9,"Trance Open":0.43},"perc":{"Congas":0.74,"Bongos":0.9,"Toms":0.64,"808 kit":1.14,"Shakers":1.67,"Zaps":1.56,"Woodblocks":1.0,"Clicks":1.8,"Tabla":0.78,"Cajon":1.44,"Cowbell":1.24,"Blocks":1.08,"Shaker Bell":2.19},"bass":{"Sub":0.92,"Square":0.96,"Saw":1.0,"Acid":0.89,"Reese":1.0,"Organ":1.51,"FM":1.19,"Pluck":1.8,"Psy":1.8,"Rubber":1.43,"Dist":0.71,"Octave":1.82},"chords":{"Piano":1.2,"Organ":0.55,"Rhodes":0.55,"Supersaw":1.0,"Dub":0.9,"Pluck":1.7,"Stab":1.09,"Wurli":0.41,"Glass Keys":0.89,"Choir Stab":1.96},"pad":{"Strings":1.02,"Warm":0.84,"Choir":1.05,"Glass":0.98,"Drone":0.58,"Noise":1.18,"Cinematic":0.94,"Vox Pad":1.18},"arp":{"Pluck":1.0,"Bell":0.64,"Marimba":0.74,"Pizzicato":1.76,"Blip":1.05,"Acid":0.62,"Glass":1.0,"Koto":0.82,"Harp":0.54},"lead":{"Pluck":1.8,"Saw":1.8,"Square":0.92,"Fuzz":0.93,"Supersaw":1.08,"Bell":0.86,"Whistle":0.71,"Vox":1.27,"Marimba":1.1,"Acid":0.66,"Saw Stack":2,"Flute":0.57,"Theremin":0.58}}/*END*/;
const trim=(id,nm)=>(TRIM[id]&&TRIM[id][nm])||1;

// ---------- run state ----------
let seed,G,rng,ctx,S,phase,hist,arrBar,arrPos,skip,skipAll,focus,liveKey,rulesFor,rulesPass,ruleEls=[],lastParts,plan,stages,qi,live=EMPTY,want='';
let ac=null,N={bus:{},tap:{}},noiseBuf=null,playing=false,started=false,ticker=null,nextT=0,step=0,gbar=0,stepDur=.12,q=[],lastPh=-1;
// ---- the set ----
// A set is several songs. The 72-bar arrangement plays `setRounds` times, then the next song is
// built and takes over on the bar line. The next one is resolved a whole round early, because
// runAll() is a synchronous search of about 60 ms and doing it on the handover would starve the
// scheduler; `holdClock` keeps both installs from moving the audio clock under the ticker.
// `wantNext` is the NEXT key: the next song lands on the coming downbeat, the same way a round does.
let setRounds=3,setRound=0,pendingSong=null,holdClock=false,wantNext=false;
// Jev's brief (js/jev.js): what the user asked for, pinned over every song of the set until changed
let brief=null;
// The scheduler looks further ahead while the tab is hidden: background timers are throttled
// to about one call a second, so the 140 ms lookahead used on screen would run dry between them.
const AHEAD=.14,AHEAD_HIDDEN=2.5;
// UI work is only queued while the page is visible. The animation frame stops in a hidden tab,
// so queued updates would pile up with nothing to draw them. Audio scheduling is unaffected.
const ui=(t,fn)=>{if(!document.hidden)q.push({t,fn})};
let facc={},fn={},fbin=null,fdata=null;

// ---------- DOM: lanes ----------
const LANES={};
(function buildLanes(){
  const host=$('lanes');
  const head=el('div','lane head');head.append(el('span'));const hc=el('div','cells');for(let k=0;k<16;k++)hc.append(el('span','c',k%4===0?String(k/4+1):''));head.append(hc,el('span'));host.append(head);
  LAYERS.forEach((L,i)=>{
    const base='lane'+(L.pitch?' pitch':''),row=el('div',base+' pending');
    row.style.setProperty('--col',COL[L.id][0]);row.style.setProperty('--col-d',COL[L.id][1]);
    const nm=el('button','lname',L.name);nm.type='button';nm.setAttribute('aria-label','Show rules for the '+L.long);
    nm.addEventListener('click',()=>{focus=i;const lp=lastParts[i];showRules(i,lp?lp.pass:1)});
    const cells=el('div','cells'),cs=[];for(let k=0;k<16;k++){const c=el('span','c');c.append(el('b'));cells.append(c);cs.push(c)}
    const fit=el('span','fit','–');row.append(nm,cells,fit);host.append(row);LANES[L.id]={row,cs,fit,base,st:'pending',off:false};
  });
})();
function renderLive(L){for(const Lr of LAYERS){const id=Lr.id,ln=LANES[id];for(let i=0;i<16;i++){const b=ln.cs[i].firstChild;let o=0,bot=null;
  if(i<L.gapFrom){
    if(id==='bass'){if(L.bass&&L.bass[i]>=0){o=1;bot=BSEM[L.bass[i]]/12*33}}
    else if(id==='lead'){if(L.lead&&L.lead[i]>=0){o=1;bot=L.lead[i]/9*33}}
    else if(id==='arp'){if(L.arp&&L.arp[i]>=0){o=1;bot=L.arp[i]/5*33}}
    else if(id==='perc'){const v=L.v.perc;if(v&&v[i]){o=.3+.7*v[i];bot=(L.pd[i]-1)/2*33}}
    else if(id==='chords')o=L.chordHit&&L.chordHit[i]?1:0;
    else if(id==='pad')o=L.pad&&L.pad[i]?.8:0;
    else{const v=L.v[id];o=v&&v[i]?.25+.75*v[i]:0}}
  b.style.opacity=o;if(bot!==null)b.style.bottom=bot+'px'}}}
function laneClass(id){const ln=LANES[id];ln.row.className=ln.base+' '+ln.st+(ln.off?' off':'')}
function laneState(id,st,txt){const ln=LANES[id];ln.st=st;ln.fit.textContent=txt;laneClass(id)}
function setPlayhead(s){for(const id in LANES){const cs=LANES[id].cs;if(lastPh>=0)cs[lastPh].classList.remove('ph');if(s>=0)cs[s].classList.add('ph')}lastPh=s}

// ---------- DOM: rules, chips, harmony, mix map, instruments ----------
function showRules(i,pass){rulesFor=i;rulesPass=pass;const L=LAYERS[i],R=rulesOf(L,pass,G);$('ruleTitle').textContent='Rules for the '+L.long;const ul=$('ruleList');ul.textContent='';ruleEls=[];
  R.forEach(r=>{const li=el('li','rule');li.style.setProperty('--col',COL[L.id][0]);li.style.setProperty('--col-d',COL[L.id][1]);
    const h=el('div','rhead'),nm=el('span','rname',r.n),v=el('span','rval','–');if(r.two)nm.append(el('span','tag','second pass'));h.append(nm,v);
    const bar=el('div','rbar'),fill=el('span');bar.append(fill);
    const why=el('p','rwhy',typeof r.why==='function'?r.why(G):r.why);
    if(r.src){const a=el('a','rsrc',SRC[r.src]);a.href='#s-'+r.src;a.addEventListener('click',e=>{e.preventDefault();const t=$('s-'+r.src);if(t)t.scrollIntoView({behavior:reduced?'auto':'smooth',block:'center'})});why.append(' ',a)}
    li.append(h,bar,why);ul.append(li);ruleEls.push({v,fill})});
  const lp=lastParts[i];setRuleVals(lp&&lp.pass===pass?lp.parts:null)}
function setRuleVals(parts){ruleEls.forEach((e,k)=>{if(!parts||parts[k]==null){e.v.textContent='–';e.fill.style.width='0%'}else{const pc=Math.round(parts[k]*100);e.v.textContent=pc+'%';e.fill.style.width=pc+'%'}})}
const ms=x=>(x>=0?'+':'−')+Math.abs(Math.round(x*1000));
function renderDNA(){const d=$('dna');d.textContent='';[['Style',G.style],['Tempo',G.bpm+' BPM'],['Key',G.keyName],['Swing',Math.round(G.swing*100)+'%'],['Timing, ms','hats '+ms(G.feel.hat)+' · clap '+ms(G.feel.clap)],['Run','#'+seed]].forEach(([k,v])=>{const c=el('div','chip');c.append(el('dt',null,k),el('dd',null,v));d.append(c)})}
let pboxes=[];
function renderHarmony(p,found){
  $('scaleSub').textContent='Every note in this run comes from the '+G.keyName+' scale. The kick is tuned to '+NOTE[G.pc]+'.';
  const sc=$('scale');sc.textContent='';G.scale.forEach((s,i)=>sc.append(el('span','note'+(i===0?' home':''),NOTE[(G.pc+s)%12])));
  const pr=$('prog');pr.textContent='';pboxes=[];
  (p||HOME).roots.forEach((rt,i)=>{const info=chordInfo(rt,G),b=el('div','pbox');b.append(el('span','bn','Bar '+(i+1)),el('span','rom',info.rom),el('span','nm',info.name));pr.append(b);pboxes.push(b)});
  $('progNote').textContent=found?'A loop of 4 bars. The bass, the pad and the arpeggio all follow these chords.':'The chords are not found yet. Until then every bar uses the home chord.'}
function hiBar(bi){pboxes.forEach((b,i)=>b.classList.toggle('now',i===bi))}
const MIXC={};
(function buildMix(){const host=$('mix');host.append(el('span'));BANDS.forEach(b=>host.append(el('span','mh',b)));
  LAYERS.forEach(L=>{host.append(el('span','ml',L.name));MIXC[L.id]=[];for(let b=0;b<6;b++){const c=el('span','mc');c.style.setProperty('--col',COL[L.id][1]);const f=el('b');c.append(f);host.append(c);MIXC[L.id].push(f)}})})();
function measuredF(id){return fn[id]>=12?facc[id].map(x=>x/fn[id]):null}
function currentF(){const F={};let sc=0,k=0;for(const id of IDS){const m=measuredF(id);if(m){F[id]=m;const a=m.reduce((x,y)=>x+y,0),b=F0[id].reduce((x,y)=>x+y,0);if(a>0){sc+=a/b;k++}}}
  const scale=k?sc/k:1;for(const id of IDS)if(!F[id])F[id]=F0[id].map(x=>x*scale);return F}
function renderMix(){let heard=0;for(const id of IDS){const m=measuredF(id);if(m)heard++;const mx=m?Math.max.apply(null,m)||1:1;MIXC[id].forEach((f,b)=>{f.style.opacity=m?Math.pow(m[b]/mx,.6).toFixed(2):0})}
  $('mixSub').textContent='Where each part puts its energy, from low to high. The page measures this from the live sound. Heard so far: '+heard+' of '+IDS.length+' parts.'}
let nInst=0;LAYERS.forEach(L=>{nInst+=Object.keys(LIB(L.id)).length});
function renderInst(){const host=$('inst');host.textContent='';
  LAYERS.forEach(L=>{const row=el('div','irow');row.style.setProperty('--col',COL[L.id][0]);row.append(el('span','iname',L.name));const box=el('div','ipills');
    Object.keys(LIB(L.id)).forEach(nm=>{const b=el('button','ip',nm);b.type='button';b.setAttribute('aria-pressed',String(G.inst[L.id]===nm));b.addEventListener('click',()=>{G.inst[L.id]=nm;renderInst()});box.append(b)});
    row.append(box);host.append(row)});
  $('instSub').textContent='This run uses '+LAYERS.length+' of '+nInst+' instruments. They are highlighted. Tap any other name to swap it in while the track plays.'}
(function buildStyles(){const ul=$('styleList');let fam='';STYLES.forEach(s=>{if(s.fam!==fam){fam=s.fam;ul.append(el('li','fam',fam))}const li=el('li'),sp=el('span');sp.append(el('strong',null,s.name+'.'),' '+(s.bpm[0]===s.bpm[1]?s.bpm[0]:s.bpm[0]+' to '+s.bpm[1])+' BPM. '+s.sig);li.append(sp);ul.append(li)});
  const n=$('nInst');if(n)n.textContent=String(nInst);const m=$('nStyles');if(m)m.textContent=String(STYLES.length)})();

// ---------- charts ----------
function fitCanvas(cv){const dpr=Math.min(window.devicePixelRatio||1,3),w=cv.clientWidth,h=cv.clientHeight;if(cv.width!==Math.round(w*dpr)||cv.height!==Math.round(h*dpr)){cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr)}const c=cv.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);return{c,w,h}}
function drawChart(){const{c,w,h}=fitCanvas($('chart'));if(!w)return;c.fillStyle='#ffffff';c.fillRect(0,0,w,h);
  const L=34,R=8,T=34,B=22,pw=w-L-R,ph=h-T-B,n=Math.max(56,hist.length+2),x=i=>L+(i+.5)/n*pw,y=v=>T+(1-v)*ph;
  c.font='500 10px Inter, system-ui, sans-serif';c.lineWidth=1;c.textBaseline='middle';c.textAlign='right';
  [0,.5,1].forEach(v=>{c.strokeStyle='#e6ebf1';c.beginPath();c.moveTo(L,y(v)+.5);c.lineTo(w-R,y(v)+.5);c.stroke();c.fillStyle='#6b7c93';c.fillText(Math.round(v*100)+'%',L-6,y(v))});
  c.textAlign='center';c.textBaseline='top';c.fillStyle='#6b7c93';
  for(let i=0;i<n;i+=8)c.fillText(String(i+1),x(i),h-B+6);
  c.textAlign='right';c.fillText('bar',w-R,h-B+6);
  if(!hist.length){c.textAlign='center';c.textBaseline='middle';c.font='500 12px Inter, system-ui, sans-serif';c.fillText('Dots appear here when the search starts.',L+pw/2,T+ph/2);return}
  let a=0,p2a=-1;while(a<hist.length){let b=a;while(b+1<hist.length&&hist[b+1].li===hist[a].li&&hist[b+1].pass===hist[a].pass)b++;
    const id=LAYERS[hist[a].li].id,col=COL[id];
    c.fillStyle=col[0];c.globalAlpha=.6;
    for(let i=a;i<=b;i++){const cs=hist[i].cands,m=cs.length;for(let k=0;k<m;k++){c.beginPath();c.arc(x(i)+((k/(m-1||1))-.5)*.7*pw/n,y(cs[k]),1.5,0,6.283);c.fill()}}
    c.globalAlpha=1;c.strokeStyle=col[1];c.lineWidth=2;c.lineJoin='round';c.beginPath();
    for(let i=a;i<=b;i++){if(i===a)c.moveTo(x(i),y(hist[i].best));else c.lineTo(x(i),y(hist[i].best))}c.stroke();
    c.fillStyle=col[1];c.beginPath();c.arc(x(b),y(hist[b].best),hist[b].done?3.2:2.2,0,6.283);c.fill();
    if(hist[a].pass===1){c.font='600 10px Inter, system-ui, sans-serif';c.textAlign='center';c.textBaseline='top';
      const lx=Math.max(L+14,Math.min(w-R-14,(x(a)+x(b))/2));c.fillText(LAYERS[hist[a].li].name.split(' ')[0],lx,4+(hist[a].li%2)*13)}
    else if(p2a<0)p2a=a;
    a=b+1}
  if(p2a>=0){const xa=x(p2a)-pw/n/2;c.strokeStyle='#a3b1c2';c.setLineDash([3,3]);c.lineWidth=1;c.beginPath();c.moveTo(xa,T-4);c.lineTo(xa,h-B);c.stroke();c.setLineDash([]);
    c.fillStyle='#0a2540';c.font='600 10px Inter, system-ui, sans-serif';c.textBaseline='top';c.textAlign='left';const tw=c.measureText('Second pass').width;c.fillText('Second pass',Math.min(xa+4,w-R-tw),4)}}
function drawArr(){const{c,w,h}=fitCanvas($('arr'));if(!w)return;c.fillStyle='#ffffff';c.fillRect(0,0,w,h);if(!plan)return;
  const L=44,R=4,T=18,n=plan.length,cw=(w-L-R)/n,rh=(h-T-4)/IDS.length;
  c.font='600 9px Inter, system-ui, sans-serif';c.textBaseline='top';c.textAlign='center';c.fillStyle='#0a2540';
  let k=0;while(k<n){let e=k;while(e+1<n&&plan[e+1].si===plan[k].si)e++;c.fillText(plan[k].n,L+(k+e+1)/2*cw,4);k=e+1}
  IDS.forEach((id,r)=>{const y=T+r*rh;c.textAlign='left';c.textBaseline='middle';c.fillStyle='#6b7c93';c.fillText(LAYERS[r].name,0,y+rh/2);
    for(let b=0;b<n;b++){const pb=plan[b],x=L+b*cw+(pb.first?1.5:0),bw=cw-(pb.first?1.5:0)+.4;
      if(pb.on[id]||(id==='clap'&&pb.roll)){c.fillStyle=COL[id][0];c.fillRect(x,y+1,bw,rh-2);
        if(pb.fill&&(id==='kick'||id==='clap')){c.fillStyle=COL[id][1];c.fillRect(L+(b+.7)*cw,y+1,cw*.3,pb.fill===2?rh-2:(rh-2)/2)}}
      else{c.fillStyle='#f3f6fa';c.fillRect(x,y+1,bw,rh-2)}}});
  if(arrPos>=0){const x=L+(arrPos+.5)*cw;c.strokeStyle='#0a2540';c.lineWidth=1.5;c.beginPath();c.moveTo(x,T-3);c.lineTo(x,h-2);c.stroke()}}

// ---------- audio: mixer ----------
function tanhCurve(k){const n=1024,a=new Float32Array(n),d=Math.tanh(k);for(let i=0;i<n;i++){const x=i/(n-1)*2-1;a[i]=Math.tanh(k*x)/d}return a}
function filt(type,f,qv){const b=ac.createBiquadFilter();b.type=type;b.frequency.value=f;if(qv)b.Q.value=qv;return b}
function gain(v){const n=ac.createGain();n.gain.value=v;return n}
function panNode(v){if(ac.createStereoPanner){const p=ac.createStereoPanner();p.pan.value=v;return p}return ac.createGain()}
function chain(){for(let i=0;i<arguments.length-1;i++)arguments[i].connect(arguments[i+1])}
function comp(th,kn,ra,at,re){const c=ac.createDynamicsCompressor();c.threshold.value=th;c.knee.value=kn;c.ratio.value=ra;c.attack.value=at;c.release.value=re;return c}
function initAudio(octx){
  const AC=window.AudioContext||window.webkitAudioContext;ac=octx||new AC();
  // master: rumble filter, gentle EQ, glue compressor, soft clip, limiter
  N.pre=gain(.8);const ls=filt('lowshelf',90),hs=filt('highshelf',9000);ls.gain.value=1.5;hs.gain.value=2;
  N.clip=ac.createWaveShaper();N.clip.curve=tanhCurve(1.3);N.clip.oversample='2x';
  N.an=ac.createAnalyser();N.an.fftSize=2048;N.an.smoothingTimeConstant=.8;
  chain(N.pre,filt('highpass',28,.7),ls,hs,comp(-16,10,3,.012,.2),N.clip,comp(-3,0,20,.001,.06),N.an,ac.destination);
  N.drum=gain(1);N.drum.connect(N.pre);N.duck=gain(1);N.duck.connect(N.pre);
  N.dhp=filt('highpass',30,.7);N.dhp.connect(N.drum);N.mlp=filt('lowpass',18000,.9);N.mlp.connect(N.duck);
  IDS.forEach(id=>{const b=gain(1);N.bus[id]=b;b.connect(id==='bass'?N.duck:(id==='chords'||id==='lead'||id==='pad'||id==='arp')?N.mlp:N.dhp);
    const a=ac.createAnalyser();a.fftSize=2048;a.smoothingTimeConstant=0;b.connect(a);N.tap[id]=a});
  N.kickSh=ac.createWaveShaper();N.kickSh.curve=tanhCurve(2.2);N.kickSh.connect(N.bus.kick);
  N.hard=ac.createWaveShaper();N.hard.curve=tanhCurve(6);const hg=gain(.8);N.hard.connect(hg);hg.connect(N.bus.kick);
  N.bassSh=ac.createWaveShaper();N.bassSh.curve=tanhCurve(1.6);N.bassSh.connect(N.bus.bass);
  N.curve3=tanhCurve(3);
  const re=new Float32Array(9),im=new Float32Array([0,1,.8,.45,.3,0,.2,0,.12]);N.organ=ac.createPeriodicWave(re,im);
  // stereo reverb with pre-delay
  const len=Math.floor(ac.sampleRate*2.8),ir=ac.createBuffer(2,len,ac.sampleRate);
  for(let ch=0;ch<2;ch++){const d=ir.getChannelData(ch);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,2.4)}
  N.rev=ac.createConvolver();N.rev.buffer=ir;N.revIn=gain(1);const pd=ac.createDelay(.1);pd.delayTime.value=.02;
  chain(N.revIn,filt('highpass',250,.7),pd,N.rev,gain(.5),N.duck);
  // ping-pong delay
  N.ppIn=gain(1);N.dL=ac.createDelay(1.5);N.dR=ac.createDelay(1.5);const lpL=filt('lowpass',3400),lpR=filt('lowpass',3400),ret=gain(.5);ret.connect(N.duck);
  chain(N.ppIn,N.dL,lpL,panNode(-.75),ret);chain(lpL,gain(.4),N.dR,lpR,panNode(.75),ret);chain(lpR,gain(.4),N.dL);
  // metallic source for hats: six square waves at clashing ratios
  N.metal=gain(1);[2,3,4.16,5.43,6.79,8.21].forEach(r=>{const o=ac.createOscillator();o.type='square';o.frequency.value=40*r;const og=gain(.17);o.connect(og);og.connect(N.metal);o.start()});
  noiseBuf=ac.createBuffer(1,ac.sampleRate*2,ac.sampleRate);const nd=noiseBuf.getChannelData(0);for(let i=0;i<nd.length;i++)nd[i]=Math.random()*2-1;
  // band lookup for the mix map
  const bins=1024,edges=[20,80,250,800,2500,7000,20000];fbin=new Int8Array(bins);fdata=new Float32Array(bins);
  for(let k=0;k<bins;k++){const f=k*ac.sampleRate/2048;let b=-1;for(let e=0;e<6;e++)if(f>=edges[e]&&f<edges[e+1])b=e;fbin[k]=b}
}
function unlockIOS(){if(N.keep)return;try{const n=4000,bytes=new Uint8Array(44+n),dv=new DataView(bytes.buffer),wr=(o,s)=>{for(let i=0;i<s.length;i++)bytes[o+i]=s.charCodeAt(i)};
  wr(0,'RIFF');dv.setUint32(4,36+n,true);wr(8,'WAVEfmt ');dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,1,true);dv.setUint32(24,8000,true);dv.setUint32(28,8000,true);dv.setUint16(32,1,true);dv.setUint16(34,8,true);wr(36,'data');dv.setUint32(40,n,true);bytes.fill(128,44);
  let s='';for(let i=0;i<bytes.length;i++)s+=String.fromCharCode(bytes[i]);
  const a=new Audio('data:audio/wav;base64,'+btoa(s));a.loop=true;a.setAttribute('playsinline','');const p=a.play();if(p&&p.catch)p.catch(()=>{});N.keep=a}catch(e){}}
function setTempo(){stepDur=60/G.bpm/4;if(ac){N.dL.delayTime.setValueAtTime(stepDur*3,ac.currentTime);N.dR.delayTime.setValueAtTime(stepDur*3,ac.currentTime)}}
function noise(t,dur){const s=ac.createBufferSource();s.buffer=noiseBuf;s.loop=true;s.start(t,Math.random()*1.5);s.stop(t+dur);return s}
function send(src,dest,v){const s=ac.createGain();s.gain.value=v;src.connect(s);s.connect(dest)}

// ---------- audio: the two instrument engines. Every instrument in the library is data played by one of these. ----------
function drum(t,v,parts,bus,pan,tune,rev){const out=ac.createGain();if(pan){const p=panNode(pan);out.connect(p);p.connect(bus)}else out.connect(bus);if(rev)send(out,N.revIn,rev);
  for(const q of parts){const g=ac.createGain(),s=t+(q[8]||0);g.gain.value=0;g.connect(out);
    if(q[0]==='o'){const o=ac.createOscillator(),k=q[7]?tune:1;o.type=q[1];o.frequency.setValueAtTime(q[2]*k,s);o.frequency.exponentialRampToValueAtTime(q[3]*k,s+q[4]);
      g.gain.setValueAtTime(.0001,s);g.gain.linearRampToValueAtTime(v*q[6],s+.002);g.gain.exponentialRampToValueAtTime(.0001,s+q[5]);o.connect(g);o.start(s);o.stop(s+q[5]+.03)}
    else if(q[0]==='n'){const at=q[6]||.001,n=noise(s,at+q[4]+.05),f=filt(q[1],q[2],q[3]);g.gain.setValueAtTime(.0001,s);g.gain.linearRampToValueAtTime(v*q[5],s+at);g.gain.exponentialRampToValueAtTime(.0001,s+at+q[4]);n.connect(f);f.connect(g)}
    else if(q[0]==='m'){const mg=gain(1.3),bp=filt('bandpass',q[1],.7),hp=filt('highpass',q[2]),n=noise(s,q[3]+.06),ng=gain(.4);
      g.gain.setValueAtTime(.0001,s);g.gain.linearRampToValueAtTime(v*q[4],s+.001);g.gain.exponentialRampToValueAtTime(.0001,s+q[3]);
      N.metal.connect(mg);mg.connect(bp);bp.connect(hp);n.connect(ng);ng.connect(hp);hp.connect(g);n.onended=()=>{try{N.metal.disconnect(mg)}catch(e){}}}
    else{const n=noise(s,q[2]+.1),bp=filt('bandpass',q[1],1.1),gg=g.gain;for(let i=0;i<3;i++){const a=s+i*.011;gg.setValueAtTime(v*q[3],a);gg.exponentialRampToValueAtTime(v*q[3]*.2,a+.009)}
      gg.setValueAtTime(v*q[3],s+.033);gg.exponentialRampToValueAtTime(.0001,s+.033+q[2]);n.connect(bp);bp.connect(g)}}}
function tone(t,midi,dur,vel,P,bus,sw,br){
  const hz=mtof(midi),a=P.a||.004,hold=P.s>0,end=hold?t+Math.max(dur,a+.03):t+P.d,rel=P.r||.05,stop=(hold?end+rel*5:t+P.d*1.5)+.02,pk=vel*(P.g||1),g=ac.createGain();
  g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(pk,t+a);
  if(hold){g.gain.setTargetAtTime(pk*P.s,t+a,P.d/3);g.gain.setTargetAtTime(0,end,rel)}else g.gain.setTargetAtTime(0,t+a,P.d/4);
  let src,node;const fm=P.fmts?P.fmts[midi%P.fmts.length]:P.fmt;
  if(fm){src=ac.createGain();node=ac.createGain();for(const q of fm){const b=filt('bandpass',q[0],q[1]),bg=gain(q[2]*3);src.connect(b);b.connect(bg);bg.connect(node)}}
  else if(P.f){const F=P.f,base=Math.min(16000,(F[5]?hz*F[1]:F[1])*(br||1)*(1+(sw||0)*(P.sw||0))),f=filt(F[0],base,F[4]||.7);
    if(F[2]>1){f.frequency.setValueAtTime(Math.min(18000,base*F[2]),t);f.frequency.setTargetAtTime(base,t+.003,F[3]/3)}src=node=f}
  else src=node=ac.createGain();
  const n=P.o.length;let lfo=null;
  if(P.vib){const l=ac.createOscillator();lfo=ac.createGain();l.frequency.value=P.vib[0];lfo.gain.setValueAtTime(0,t);lfo.gain.linearRampToValueAtTime(P.vib[1],t+.25);l.connect(lfo);l.start(t);l.stop(stop)}
  P.o.forEach((q,i)=>{const o=ac.createOscillator(),og=gain(q[3]),fr=hz*Math.pow(2,q[2]);
    if(q[0]==='organ')o.setPeriodicWave(N.organ);else o.type=q[0];o.frequency.value=fr;o.detune.value=q[1];
    if(P.fm){const m=ac.createOscillator(),mg=ac.createGain(),ix=fr*P.fm[1];m.frequency.value=fr*P.fm[0];mg.gain.setValueAtTime(ix,t);mg.gain.setTargetAtTime(ix*P.fm[3],t,P.fm[2]/3);m.connect(mg);mg.connect(o.frequency);m.start(t);m.stop(stop)}
    if(lfo)lfo.connect(o.detune);
    o.connect(og);if(P.w&&n>1){const pn=panNode(P.w*(i/(n-1)*2-1));og.connect(pn);pn.connect(src)}else og.connect(src);
    o.start(t);o.stop(stop)});
  if(P.air){const nz=noise(t,stop-t),bp=filt('bandpass',Math.min(12000,hz*P.air[0]),P.air[1]);nz.connect(bp);bp.connect(src)}
  node.connect(g);let out=g;
  if(P.drv){const ws=ac.createWaveShaper(),og=gain(P.drv);ws.curve=N.curve3;g.connect(ws);ws.connect(og);out=og}
  out.connect(bus);if(P.dly)send(out,N.ppIn,P.dly);if(P.rev)send(out,N.revIn,P.rev)}
function pDrum(id,nm,t,v,pan,tune,rev){const P=KIT[id][nm];drum(t,v*LEVEL[id]*trim(id,nm),P.p,N.bus[id],pan,tune||1,rev==null?P.rev:rev)}
function pKick(t,v){const nm=G.inst.kick,P=KIT.kick[nm];drum(t,v*LEVEL.kick*trim('kick',nm),P.p,P.drv?N.hard:N.kickSh,0,G.kickHz);N.duck.gain.setTargetAtTime(G.duck,t,.004);N.duck.gain.setTargetAtTime(1,t+.06,.07)}
function pPerc(t,v,d){const nm=G.inst.perc,P=KIT.perc[nm];drum(t,v*LEVEL.perc*trim('perc',nm),P.p3[d-1],N.bus.perc,G.percPan*(d-2),1,P.rev)}
function pTone(id,t,midi,dur,vm,sw,bus){const nm=G.inst[id];tone(t,midi,dur,LEVEL[id]*trim(id,nm)*vm,SYN[id][nm],bus||N.bus[id],sw,G.br[id])}
function crash(t,v){const n=noise(t,1.7),hp=filt('highpass',4500),g=ac.createGain();g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(.0001,t+1.5);n.connect(hp);hp.connect(g);g.connect(N.drum);send(g,N.revIn,.3)}
function riser(t,d,v){v=v||.2;const n=noise(t,d+.1),f=filt('bandpass',300,1.4),g=ac.createGain();f.frequency.setValueAtTime(300,t);f.frequency.exponentialRampToValueAtTime(9000,t+d);g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(v,t+d);g.gain.linearRampToValueAtTime(.0001,t+d+.05);n.connect(f);f.connect(g);g.connect(N.drum);
  const o=ac.createOscillator(),og=ac.createGain();o.type='sine';o.frequency.setValueAtTime(mtof(G.low+36),t);o.frequency.exponentialRampToValueAtTime(mtof(G.low+60),t+d);og.gain.setValueAtTime(.0001,t);og.gain.linearRampToValueAtTime(v*.3,t+d);og.gain.linearRampToValueAtTime(.0001,t+d+.05);o.connect(og);og.connect(N.drum);send(og,N.revIn,.4);o.start(t);o.stop(t+d+.1)}
function downlift(t,d){const n=noise(t,d+.1),f=filt('lowpass',9000,1),g=ac.createGain();f.frequency.setValueAtTime(9000,t);f.frequency.exponentialRampToValueAtTime(200,t+d);g.gain.setValueAtTime(.16,t);g.gain.exponentialRampToValueAtTime(.0001,t+d);n.connect(f);f.connect(g);g.connect(N.drum);send(g,N.revIn,.3)}
function impact(t){const o=ac.createOscillator(),g=ac.createGain();o.type='sine';o.frequency.setValueAtTime(G.kickHz*3,t);o.frequency.exponentialRampToValueAtTime(G.kickHz*.75,t+.5);g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(.5,t+.005);g.gain.exponentialRampToValueAtTime(.0001,t+1.3);o.connect(g);g.connect(N.drum);o.start(t);o.stop(t+1.4)}
// one test hit or note, as the sequencer would play it. Used by the offline level check.
function testHit(id,nm,t){const keep=G.inst[id];G.inst[id]=nm;
  if(id==='kick')pKick(t,1);else if(id==='perc')[1,2,3].forEach((d,i)=>pPerc(t+i*.2,1,d));else if(KIT[id])pDrum(id,nm,t,1);
  else if(id==='bass')pTone('bass',t,bassMidi(0,0,G),.22,1,.35,N.bassSh);
  else if(id==='chords'||id==='pad'){const vv=SYN[id][nm].low?[bassMidi(0,0,G)+12,bassMidi(0,0,G)+19]:voicing(0,0,G);for(const m of vv)pTone(id,t,m,id==='pad'?1.4:.11,1/Math.sqrt(vv.length),.35)}
  else if(id==='arp')pTone('arp',t,arpNote(0,2,G),.1,1,.35);
  else pTone('lead',t,G.leadBase+semi(4,G),.22,1,.35);
  G.inst[id]=keep}
async function renderOne(id,nm){const br0=G.br[id];G.br[id]=1;try{return await renderRaw(id,nm)}finally{G.br[id]=br0}}
async function renderRaw(id,nm){const OC=window.OfflineAudioContext||window.webkitOfflineAudioContext,dur=id==='pad'?1.7:.8,oc=new OC(1,Math.ceil(44100*dur),44100),keep={ac,N,fbin,fdata,noiseBuf};
  N={bus:{},tap:{}};initAudio(oc);N.an.disconnect();N.bus[id].connect(oc.destination);testHit(id,nm,.02);
  const pr=oc.startRendering();ac=keep.ac;N=keep.N;fbin=keep.fbin;fdata=keep.fdata;noiseBuf=keep.noiseBuf;
  const d=(await pr).getChannelData(0),a=Math.floor(44100*(id==='pad'?.5:.02)),b=Math.floor(44100*(id==='pad'?1.5:id==='perc'?.62:id==='ohat'?.37:.27));let pk=0,e=0,bad=0;
  for(let i=0;i<d.length;i++){const x=d[i];if(x!==x)bad++;else{if(Math.abs(x)>pk)pk=Math.abs(x);if(i>=a&&i<b)e+=x*x}}
  return{peak:pk,rms:Math.sqrt(e/(b-a)),bad}}

// ---------- search controller and sequencer ----------
function thin(a){if(a.length<=48)return a.slice();const o=[],st=a.length/48;for(let i=0;i<48;i++)o.push(a[Math.floor(i*st)]);return o}
function startStage(){const st=stages[qi];ctx.pass=st.pass;if(st.pass===2)ctx.F=currentF();const s=newSearch(st.i,ctx,rng);if(st.pass===2)stepSearch(s,ctx,rng);return s}
function snapOf(s){return{li:s.i,pass:s.pass,id:s.L.id,score:s.score,parts:s.parts,tried:s.tried,done:s.done,cands:thin(s.cands)}}
function toTrack(){phase='play';arrBar=-1}
// Build the whole track in one go: runAll() is the same search without the audio clock, so the
// minutes of bar-by-bar searching collapse into about 60 ms. The chart stays empty on purpose —
// there was no search to watch.
function buildNow(){
  if(phase!=='search')return false;
  const run=runAll(seed,want,brief);
  G=run.G;ctx=run.ctx;plan=makePlan(G);S=null;qi=stages.length;
  IDS.forEach(id=>{const s=run.out.concat(run.out2).find(x=>x.L.id===id);
    laneState(id,'locked',s?Math.round(s.score*100)+'%':'–');
    if(s)lastParts[IDS.indexOf(id)]={parts:s.parts,pass:s.pass}});
  hist=[];toTrack();arrBar=-1;arrPos=-1;gbar=0;step=0;live=EMPTY;
  if(ac&&!holdClock)nextT=ac.currentTime+.05;
  renderHarmony(ctx.pat.chords||HOME,true);renderLive(EMPTY);setPlayhead(-1);drawChart();drawArr();
  $('skip').disabled=true;$('skipall').disabled=true;$('stat2').textContent='';
  $('status').textContent=playing?'Built in one go. Here it comes.':'Built in one go. Press Start to play the track.';
  return true}
// A saved take restores the resolved patterns and genome instead of re-running the search, so later
// edits to the rules or the instrument pools cannot change a take that is already saved.
function loadSnapshot(st){
  want=st.want||'';try{localStorage.setItem('bl-style2',want)}catch(e){}
  const sel=$('style');if(sel){sel.value=want;if(sel.value!==want){want='';sel.value=''}}
  newRun(st.seed);
  G=JSON.parse(JSON.stringify(st.G));
  ctx={G,pat:JSON.parse(JSON.stringify(st.pat)),pass:2,F:F0};
  plan=makePlan(G);S=null;qi=stages.length;phase='play';arrBar=-1;arrPos=-1;hist=[];gbar=0;step=0;live=EMPTY;
  if(st.inst)for(const id in st.inst){const nm=st.inst[id];if(LIB(id)&&LIB(id)[nm])G.inst[id]=nm}
  IDS.forEach(id=>laneState(id,'locked','–'));
  renderInst();renderDNA();renderHarmony(ctx.pat.chords||HOME,true);renderLive(EMPTY);setPlayhead(-1);drawChart();drawArr();
  $('skip').disabled=true;$('skipall').disabled=true;$('stat2').textContent='';
  $('status').textContent='Loaded a saved take exactly as it was. Press Start to play it.';
  if(ac)nextT=ac.currentTime+.05;
  setTempo();
  return true}
function onBar(t0){
  if(phase==='search'){
    if(skipAll){const snaps=[];while(qi<stages.length){if(!S)S=startStage();if(!S.done)polish(S,ctx,rng);ctx.pat[S.L.id]=S.pat;snaps.push(snapOf(S));S=null;qi++}
      skipAll=false;skip=false;toTrack();ui(t0,()=>snaps.forEach(uiSearch))}
    else{if(!S){S=startStage();if(qi>0&&S.pass===1)crash(t0,.08)}else if(skip){S.cands=[];polish(S,ctx,rng);skip=false}else stepSearch(S,ctx,rng);
      ctx.pat[S.L.id]=S.pat;const sn=snapOf(S);ui(t0,()=>uiSearch(sn));
      if(S.done){S=null;qi++;if(qi>=stages.length)toTrack()}}
    live=renderBar(ctx.pat,G,null,gbar);const lv=live;ui(t0,()=>uiBar(lv,null,-1))}
  else{
    arrBar++;
    if(wantNext){wantNext=false;nextSong(t0);arrBar++}
    // a round of the arrangement has finished; enough of them and the next song takes over
    else if(arrBar>0&&arrBar%plan.length===0){
      setRound++;
      if(setRound>=setRounds){nextSong(t0);arrBar++}      // nextSong leaves arrBar at -1
      else if(setRound>=setRounds-1)prewarmNext();
    }
    const k=arrBar%plan.length,pb=plan[k],bd=stepDur*16;
    live=renderBar(ctx.pat,G,pb,arrBar);live.thr=pb.fill===2;
    N.mlp.frequency.setValueAtTime(pb.lp[0],t0);if(pb.lp[1]!==pb.lp[0])N.mlp.frequency.exponentialRampToValueAtTime(pb.lp[1],t0+bd-.005);
    N.dhp.frequency.setValueAtTime(pb.hp[0],t0);if(pb.hp[1]!==pb.hp[0])N.dhp.frequency.exponentialRampToValueAtTime(pb.hp[1],t0+bd-.005);
    if(pb.first){if(pb.drop){impact(t0);crash(t0,.2)}else if(pb.n==='Break'){downlift(t0,bd*2);crash(t0,.12)}else if(pb.n==='Groove'||pb.n==='Outro')crash(t0,.12)}
    if(pb.build&&pb.e===3)riser(t0,bd*4-stepDur*4);
    if(pb.pre)riser(t0,bd,.12);
    const lv=live;ui(t0,()=>uiBar(lv,pb,k))}}
// ---------- the set: handing over to the next song ----------
// The next song is resolved during the last round of the current one, so the handover itself is
// just an install. Everything the set needs is in `run`, which is the same object buildNow() uses.
function prewarmNext(){
  if(pendingSong)return;
  const s=fresh();
  try{pendingSong={seed:s,run:runAll(s,want,brief)}}
  catch(e){pendingSong=null}
}
function nextSong(t0){
  holdClock=true;
  let p=pendingSong;
  pendingSong=null;
  if(!p){const s=fresh();try{p={seed:s,run:runAll(s,want,brief)}}catch(e){p=null}}
  if(!p){holdClock=false;return}
  seed=p.seed;G=p.run.G;ctx=p.run.ctx;plan=makePlan(G);S=null;qi=stages.length;phase='play';
  IDS.forEach(id=>{
    const s=p.run.out.concat(p.run.out2).find(x=>x.L.id===id);
    laneState(id,'locked',s?Math.round(s.score*100)+'%':'–');
    if(s)lastParts[IDS.indexOf(id)]={parts:s.parts,pass:s.pass};
  });
  hist=[];arrBar=-1;arrPos=-1;gbar=0;step=0;live=EMPTY;setRound=0;
  holdClock=false;
  setTempo();
  renderInst();renderDNA();renderHarmony(ctx.pat.chords||HOME,true);renderLive(EMPTY);
  setPlayhead(-1);drawChart();drawArr();renderMix();
  $('skip').disabled=true;$('skipall').disabled=true;$('stat2').textContent='';
  if(ac)crash(t0,.22);
  $('status').textContent='Next song · '+G.style+' · '+G.bpm+' BPM';
}

function sched(s,t0){
  if(s===0)onBar(t0);
  const L=live,t=t0+(s%2?G.swing*stepDur:0),v=L.v,now=ac.currentTime,I=G.inst;
  if(!document.hidden)q.push({t:t0,s});
  // The stage view (js/stage.js) mirrors every step it hears, including section changes.
  if(window.__stage&&window.__stage.onStep)window.__stage.onStep({s,t,v:L.v,L,bar:gbar,bpm:G.bpm,
    sec:phase==='play'&&plan?plan[((arrBar%plan.length)+plan.length)%plan.length]:null,playing});
  if(s>=L.gapFrom)return;
  if(v.kick&&v.kick[s])pKick(t,v.kick[s]);
  if(v.clap&&v.clap[s]){const tc=Math.max(now,t+G.feel.clap);if(L.roll)pDrum('clap','Snare',tc,v.clap[s]*.9,0,1+.6*(L.rp+s/64));else pDrum('clap',I.clap,tc,v.clap[s],0,1,L.thr&&s>=12?.7:null)}
  if(v.ohat&&v.ohat[s])pDrum('ohat',I.ohat,t+G.feel.hat,1,.2);
  if(v.hat&&v.hat[s])pDrum('hat',I.hat,t+G.feel.hat,v.hat[s]*(.92+Math.random()*.16),s%4===2?.22:-.14);
  if(v.perc&&v.perc[s])pPerc(t+G.feel.perc,v.perc[s]*(.9+Math.random()*.1),L.pd[s]);
  if(L.ride&&L.ride[s])drum(t+G.feel.hat,.5*LEVEL.ohat*trim('ohat','Ride')*L.ride[s],KIT.ohat.Ride.p,N.dhp,.3,1);
  const pr=ctx.pat.chords||HOME,rt=pr.roots[L.bi],sw=phase==='play'&&arrBar>=0?((arrBar%8)+s/16)/8:.35;
  if(L.bass&&L.bass[s]>=0){let k=1;while(k<4&&L.bass[(s+k)%16]<0)k++;pTone('bass',t+G.feel.bass,bassMidi(rt,L.bass[s],G),Math.min(k,G.bassGate)*stepDur*.92,L.bass[s]===2?1.2:1,sw,N.bassSh)}
  if(L.chordHit&&L.chordHit[s]){let k=1;while(s+k<L.gapFrom&&!L.chordHit[s+k])k++;const vv=voicing(rt,pr.inv[L.bi],G),P=SYN.chords[I.chords];for(const m of vv)pTone('chords',t,m,k*stepDur*(P.len||.5),1/Math.sqrt(vv.length),sw)}
  if(L.pad&&L.pad[s]&&(s===0||!L.pad[s-1])){let k=1;while(s+k<L.gapFrom&&L.pad[s+k])k++;const b0=bassMidi(rt,0,G),vv=SYN.pad[I.pad].low?[b0+12,b0+19]:voicing(rt,pr.inv[L.bi],G);for(const m of vv)pTone('pad',t,m,k*stepDur*.97,1/Math.sqrt(vv.length),sw)}
  if(L.arp&&L.arp[s]>=0)pTone('arp',t,arpNote(rt,L.arp[s],G),stepDur*.9,1,sw);
  if(L.lead&&L.lead[s]>=0){let k=1;while(s+k<16&&L.lead[s+k]<0)k++;const m=G.leadBase+semi(L.lead[s],G),d=Math.min(k,8)*stepDur*.95,lv=G.riff?.8:1;pTone('lead',t,m,d,lv,sw);if(L.oct)pTone('lead',t,m+12,d,lv*.34,sw)}}
function tick(){if(!playing||!ac)return;const lim=ac.currentTime+(document.hidden?AHEAD_HIDDEN:AHEAD);if(nextT<ac.currentTime-.3)nextT=ac.currentTime+.05;
  while(nextT<lim){sched(step,nextT);nextT+=stepDur;step=(step+1)%16;if(step===0)gbar++}}

// ---------- UI updates in time with the audio ----------
function uiSearch(n){const L=LAYERS[n.li],pc=Math.round(n.score*100),key=n.li+'/'+n.pass;
  if(liveKey!==key){liveKey=key;focus=null}
  laneState(n.id,n.done?'locked':'searching',pc+'%');
  hist.push({li:n.li,pass:n.pass,best:n.score,cands:n.cands,done:n.done});drawChart();
  lastParts[n.li]={parts:n.parts,pass:n.pass};
  if(focus===null||focus===n.li){if(rulesFor!==n.li||rulesPass!==n.pass)showRules(n.li,n.pass);else setRuleVals(n.parts)}
  $('status').textContent=n.pass===1?'Part '+(n.li+1)+' of '+LAYERS.length+' · '+L.long+' · '+G.inst[n.id]+(n.done?' · locked':''):'Second pass · tuning the '+L.long+(n.done?' · locked':'');
  $('stat2').textContent=n.tried.toLocaleString('en-US')+' tried · '+pc+'% fit';
  if(n.id==='chords')renderHarmony(ctx.pat.chords,true)}
const SECNAME={Intro:'the intro',Groove:'the groove','Drop A':'the first drop','Peak A':'the first peak',Break:'the breakdown',Build:'the build-up','Drop B':'the second drop','Peak B':'the second peak',Outro:'the outro'};
function uiBar(L,pb,k){renderLive(L);hiBar(L.bi);
  for(const id of IDS){const ln=LANES[id],off=!!pb&&!(pb.on[id]||(id==='clap'&&pb.roll));if(ln.off!==off){ln.off=off;laneClass(id)}}
  if(pb){$('status').textContent='Full track · '+SECNAME[pb.n]+(pb.fill?' · fill':'');$('stat2').textContent='bar '+(k+1)+' of '+plan.length;
    if(arrPos!==k){arrPos=k;drawArr()}
    $('skip').disabled=true;$('skipall').disabled=true}}

// ---------- spectrum and mix measurement ----------
const fbuf=new Uint8Array(1024),vals=new Float32Array(40);
let fc=0;
function drawSpec(){const{c,w,h}=fitCanvas($('spec'));if(!w)return;c.clearRect(0,0,w,h);
  const n=vals.length,liveNow=ac&&playing;if(liveNow)N.an.getByteFrequencyData(fbuf);
  const sr=ac?ac.sampleRate:44100,gap=3,bw=(w-28-gap*(n-1))/n;
  for(let i=0;i<n;i++){let v;
    if(liveNow){const f0=32*Math.pow(500,i/n),f1=32*Math.pow(500,(i+1)/n),b0=Math.floor(f0/(sr/2)*1024),b1=Math.max(b0+1,Math.ceil(f1/(sr/2)*1024));let m=0;for(let k=b0;k<b1&&k<1024;k++)m=Math.max(m,fbuf[k]);v=Math.pow(m/255,1.6)}
    else v=.1+.07*Math.sin(i*.55);
    vals[i]+=(v-vals[i])*(liveNow?.55:.08);
    const bh=Math.max(4,vals[i]*(h-22)),x=14+i*(bw+gap),y=h-10-bh;
    c.fillStyle=COL[IDS[Math.min(IDS.length-1,Math.floor(i/n*IDS.length))]][0];c.globalAlpha=liveNow?.95:.6;
    c.beginPath();if(c.roundRect)c.roundRect(x,y,bw,bh,Math.max(0,Math.min(bw/2,4)));else c.rect(x,y,bw,bh);c.fill()}
  c.globalAlpha=1}
function measure(){for(const id of IDS){const an=N.tap[id];if(!an.getFloatFrequencyData)return;an.getFloatFrequencyData(fdata);
  let e0=0,e1=0,e2=0,e3=0,e4=0,e5=0;
  for(let k=1;k<1024;k++){const db=fdata[k];if(!(db>-85))continue;const a=Math.pow(10,db/20),b=fbin[k];if(b===0)e0+=a;else if(b===1)e1+=a;else if(b===2)e2+=a;else if(b===3)e3+=a;else if(b===4)e4+=a;else if(b===5)e5+=a}
  if(e0+e1+e2+e3+e4+e5>.02){const a=facc[id];a[0]+=e0;a[1]+=e1;a[2]+=e2;a[3]+=e3;a[4]+=e4;a[5]+=e5;fn[id]++}}}
function frame(){requestAnimationFrame(frame);if($('clubView').hidden)return;
  if(ac&&playing){const now=ac.currentTime;while(q.length&&q[0].t<=now){const e=q.shift();if(e.fn)e.fn();else setPlayhead(e.s)}
    if(fc%2===0)measure();if(fc%30===0)renderMix()}
  fc++;if(!reduced||fc%8===0)drawSpec()}

// ---------- MIDI export of the 72-bar track ----------
const PERCGM={'Congas':[64,63,62],'Bongos':[61,60,37],'Toms':[45,47,50],'808 kit':[56,37,75],'Shakers':[70,54,82],'Zaps':[41,43,48],'Woodblocks':[77,76,75],'Clicks':[37,31,33],'Tabla':[64,63,62],'Cajon':[64,63,62],'Cowbell':[56,54,76],'Blocks':[76,77,75],'Shaker Bell':[82,70,54]};
const CLAPGM={'Snare':38,'Layered':40,'Rim':37,'Clap Deep':39,'Brush':39};
function clubMidi(){const ppq=480,bpm=G.bpm,sd=60/bpm/4,tk=s=>Math.max(0,Math.round(s*ppq*bpm/60)),us=Math.round(6e7/bpm),tx=s=>Array.from(s,c=>c.charCodeAt(0)&127);
  const meta=(ty,d)=>({k:0,o:0,b:[255,ty].concat(vlq(d.length),d)}),tr=(nm,ch,pg)=>{const a=[meta(3,tx(nm))];if(pg>=0)a.push({k:0,o:1,b:[0xC0|ch,pg]});return a},I=G.inst;
  const C0=[meta(3,tx('Sudo Sequencer run '+seed+' - '+G.style)),meta(0x51,[us>>16&255,us>>8&255,us&255]),meta(0x58,[4,2,24,8])];
  const D=tr('Drums',9,-1),B=tr('Bass - '+I.bass,0,38),C=tr('Chords - '+I.chords,1,81),Pd=tr('Pad - '+I.pad,3,89),Ar=tr('Arp - '+I.arp,4,80),Ld=tr('Lead - '+I.lead,2,80);
  const nt=(a,ch,p,v,s,d)=>{const k=tk(s);a.push({k,o:3,b:[0x90|ch,p,Math.max(1,Math.min(127,Math.round(v*127)))]},{k:Math.max(k+1,tk(s+d)),o:0,b:[0x80|ch,p,0]})};
  const pr=ctx.pat.chords,pg=PERCGM[I.perc]||[64,63,62],cl=CLAPGM[I.clap]||39;
  plan.forEach((pb,k)=>{const L=renderBar(ctx.pat,G,pb,k),v=L.v,b0=k*16*sd,rt=pr.roots[L.bi];
    if(pb.first&&k>0)nt(D,9,49,pb.drop?.9:.6,b0,.09);
    for(let s=0;s<L.gapFrom;s++){const t=b0+s*sd+(s%2?G.swing*sd:0);
      if(v.kick&&v.kick[s])nt(D,9,36,v.kick[s],t,.09);
      if(v.clap&&v.clap[s])nt(D,9,L.roll?38:cl,v.clap[s],Math.max(0,t+G.feel.clap),.09);
      if(v.ohat&&v.ohat[s])nt(D,9,46,.8,t+G.feel.hat,.09);
      if(v.hat&&v.hat[s])nt(D,9,42,.85*v.hat[s],t+G.feel.hat,.05);
      if(v.perc&&v.perc[s])nt(D,9,pg[L.pd[s]-1],.85*v.perc[s],t+G.feel.perc,.07);
      if(L.ride&&L.ride[s])nt(D,9,51,.6*L.ride[s],t+G.feel.hat,.09);
      if(L.bass&&L.bass[s]>=0){let q=1;while(q<4&&L.bass[(s+q)%16]<0)q++;nt(B,0,bassMidi(rt,L.bass[s],G),L.bass[s]===2?.92:.78,t+G.feel.bass,Math.min(q,G.bassGate)*sd*.92)}
      if(L.chordHit&&L.chordHit[s]){let q=1;while(s+q<L.gapFrom&&!L.chordHit[s+q])q++;for(const m of voicing(rt,pr.inv[L.bi],G))nt(C,1,m,.7,t,q*sd*.5)}
      if(L.pad&&L.pad[s]&&(s===0||!L.pad[s-1])){let q=1;while(s+q<L.gapFrom&&L.pad[s+q])q++;const b1=bassMidi(rt,0,G);for(const m of(SYN.pad[I.pad].low?[b1+12,b1+19]:voicing(rt,pr.inv[L.bi],G)))nt(Pd,3,m,.55,t,q*sd*.97)}
      if(L.arp&&L.arp[s]>=0)nt(Ar,4,arpNote(rt,L.arp[s],G),.6,t,sd*.8);
      if(L.lead&&L.lead[s]>=0){let q=1;while(s+q<16&&L.lead[s+q]<0)q++;const m=G.leadBase+semi(L.lead[s],G),d=Math.min(q*.95,SYN.lead[I.lead].hold?8:1.8)*sd;nt(Ld,2,m,.8,t,d);if(L.oct)nt(Ld,2,m+12,.45,t,d)}}});
  return midiBytes([C0,D,B,C,Pd,Ar,Ld],ppq)}

// ---------- saving audio ----------
// A full run is ~30k mixer nodes, and an OfflineAudioContext pays for every one of them: rendering
// the set offline costs minutes (measured: 3.7 s of render for 20 s of audio at 3000 hits).
// So the WAV export records the master bus while it plays instead — as long as the take, and
// exactly what the speakers get, limiter and all.
function wav16(buf){
  const ch=buf.numberOfChannels,n=buf.length,out=new Uint8Array(44+n*ch*2),dv=new DataView(out.buffer);
  const wr=(o,s)=>{for(let i=0;i<s.length;i++)out[o+i]=s.charCodeAt(i)};
  wr(0,'RIFF');dv.setUint32(4,36+n*ch*2,true);wr(8,'WAVEfmt ');dv.setUint32(16,16,true);dv.setUint16(20,1,true);
  dv.setUint16(22,ch,true);dv.setUint32(24,buf.sampleRate,true);dv.setUint32(28,buf.sampleRate*ch*2,true);
  dv.setUint16(32,ch*2,true);dv.setUint16(34,16,true);wr(36,'data');dv.setUint32(40,n*ch*2,true);
  const chans=[];for(let c=0;c<ch;c++)chans.push(buf.getChannelData(c));
  let o=44;
  for(let i=0;i<n;i++)for(let c=0;c<ch;c++){const x=chans[c][i];dv.setInt16(o,x<0?x*0x8000:x*0x7fff,true);o+=2}
  return out}
let REC=null,recTick=null;
function startRec(){
  if(REC)return REC;
  const MR=window.MediaRecorder;
  if(!MR)throw new Error('This browser cannot record audio.');
  if(!ac){try{initAudio()}catch(e){throw new Error('This browser cannot record audio.')}unlockIOS();setTempo()}
  if(!ac.createMediaStreamDestination)throw new Error('This browser cannot record audio.');
  if(!playing)resume();
  const dest=ac.createMediaStreamDestination();
  N.an.connect(dest);
  const type=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'].find(t=>!MR.isTypeSupported||MR.isTypeSupported(t))||'';
  const rec=new MR(dest.stream,type?{mimeType:type,audioBitsPerSecond:192000}:{});
  const chunks=[];
  rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
  rec.start(1000);
  REC={rec,chunks,dest,t0:performance.now()};
  const st=$('status');
  recTick=setInterval(()=>{if(!REC)return;const s=Math.floor((performance.now()-REC.t0)/1000);
    st.textContent='Recording '+Math.floor(s/60)+':'+String(s%60).padStart(2,'0')+'. Press Stop to save a WAV.'},500);
  return REC;
}
async function stopRec(){
  if(!REC)return null;
  clearInterval(recTick);recTick=null;
  const {rec,chunks,dest,t0}=REC;REC=null;
  const ended=new Promise(res=>{rec.onstop=res});
  try{rec.stop()}catch(e){}
  await ended;
  try{N.an.disconnect(dest)}catch(e){}
  const blob=new Blob(chunks,{type:(chunks[0]&&chunks[0].type)||'audio/webm'});
  const raw=await blob.arrayBuffer();
  const buf=await ac.decodeAudioData(raw.slice(0));
  return {wav:wav16(buf),secs:(performance.now()-t0)/1000,src:blob.size,rate:buf.sampleRate};
}

// ---------- transport ----------
function newRun(s){
  seed=s;G=makeGenome(seed,want,brief);rng=rngFrom(seed*31+7);ctx={G,pat:{},pass:1,F:F0};S=null;phase='search';hist=[];arrBar=-1;arrPos=-1;skip=false;skipAll=false;focus=null;liveKey='';rulesFor=-1;lastParts={};setRound=0;pendingSong=null;wantNext=false;
  plan=makePlan(G);stages=LAYERS.map((L,i)=>({i,pass:1})).concat(PASS2.map(id=>({i:IDS.indexOf(id),pass:2})));qi=0;live=EMPTY;
  IDS.forEach(id=>{facc[id]=[0,0,0,0,0,0];fn[id]=0});
  step=0;gbar=0;q=[];setPlayhead(-1);renderLive(EMPTY);
  LAYERS.forEach(L=>{LANES[L.id].off=false;laneState(L.id,'pending','–')});
  renderDNA();renderHarmony(null,false);showRules(0,1);drawChart();drawArr();renderMix();renderInst();
  $('skip').disabled=false;$('skipall').disabled=false;$('stat2').textContent='';
  $('status').textContent=playing?'New run. Starting with the kick drum.':'Press Start to hear the search.';
  setTempo();
  if(ac){const now=ac.currentTime;N.duck.gain.cancelScheduledValues(now);N.duck.gain.setValueAtTime(1,now+.16);
    N.mlp.frequency.cancelScheduledValues(now);N.mlp.frequency.setValueAtTime(18000,now+.16);N.dhp.frequency.cancelScheduledValues(now);N.dhp.frequency.setValueAtTime(30,now+.16);
    if(!holdClock)nextT=now+.3}}
function resume(){if(ac.resume)ac.resume();playing=true;if(!started){started=true;nextT=ac.currentTime+.15}
  if(!ticker)ticker=makeTicker();ticker.start(25,tick);$('play').textContent='Pause';
  if(phase==='search'&&!hist.length)$('status').textContent='Starting with the kick drum.';
  try{if(navigator.wakeLock)navigator.wakeLock.request('screen').catch(()=>{})}catch(e){}}
function pause(){playing=false;if(ticker)ticker.stop();if(ac&&ac.suspend)ac.suspend();$('play').textContent='Resume'}
const fresh=()=>((Math.random()*9000)|0)+1000;
$('play').addEventListener('click',()=>{if(!ac){try{initAudio()}catch(e){$('status').textContent='This browser blocked the sound engine.';return}unlockIOS();setTempo()}if(playing)pause();else resume()});
$('again').addEventListener('click',()=>newRun(fresh()));
$('skip').addEventListener('click',()=>{if(phase==='search')skip=true});
$('skipall').addEventListener('click',()=>{if(phase==='search')skipAll=true});
$('build').addEventListener('click',()=>buildNow());
$('cwav').addEventListener('click',async()=>{
  const st=$('status'),b=$('cwav');
  if(REC){
    b.disabled=true;st.textContent='Finishing the recording…';
    try{
      const out=await stopRec();
      const d=await DLP;if(!d||!out)throw new Error('This page could not save the file.');
      await d.save({filename:'sudo-sequencer-run-'+seed+'.wav',data:out.wav});
      st.textContent='Saved '+(out.wav.length/1048576).toFixed(1)+' MB: '+out.secs.toFixed(1)+' s of 16-bit '+(out.rate/1000)+' kHz stereo.';
    }catch(e){st.textContent=(e&&e.message)||'The recording failed.'}
    finally{b.disabled=false;b.textContent='Record → WAV'}
    return}
  if(phase!=='play'){st.textContent='Build the track first: Skip to track, or Build now.';return}
  try{startRec();b.textContent='Stop recording'}
  catch(e){st.textContent=(e&&e.message)||'This browser cannot record audio.'}});
$('cmidi').addEventListener('click',async()=>{const st=$('status');if(phase!=='play'){st.textContent='The MIDI is ready when the search ends. Press Skip to track.';return}
  const d=await DLP;if(!d)return;try{const nm='sudo-sequencer-run-'+seed;await d.save({filename:nm+'.zip',data:zipStore([{name:nm+'.mid',data:clubMidi()}])})}catch(e){st.textContent=e&&e.code==='declined'?'Download cancelled.':'This view could not save the file.'}});
DLP.then(d=>{if(d)$('cmidi').hidden=false});
try{const w=localStorage.getItem('bl-style2');if(w!==null)want=w}catch(e){}
(function(){const sel=$('style'),opt=(v,t,par)=>{const e=el('option',null,t);e.value=v;par.append(e)};opt('','Any style',sel);
  ['House','Techno','Trance'].forEach(f=>{const g=document.createElement('optgroup');g.label=f;opt('fam:'+f,'Any '+f.toLowerCase(),g);STYLES.filter(x=>x.fam===f).forEach(x=>opt(x.name,x.name,g));sel.append(g)});
  sel.value=want;if(sel.value!==want){want='';sel.value=''}
  sel.addEventListener('change',()=>{want=sel.value;try{localStorage.setItem('bl-style2',want)}catch(e){}newRun(fresh())})})();
// A hidden tab keeps playing. The audio thread is never throttled, the scheduler looks further
// ahead, and only the panels pause. On the way back they are redrawn from the current run.
document.addEventListener('visibilitychange',()=>{if(document.hidden)return;
  if(playing&&ticker)ticker.start(25,tick);
  drawChart();drawArr();renderMix();if(live)renderLive(live);
  if(phase==='play'&&plan&&arrBar>=0){$('stat2').textContent='bar '+((arrBar%plan.length)+1)+' of '+plan.length;drawArr()}});
let rz=0;window.addEventListener('resize',()=>{clearTimeout(rz);rz=setTimeout(()=>{drawChart();drawArr()},120)});
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>{drawChart();drawArr()}).catch(()=>{});
window.__bl={pause:()=>{if(playing)pause()},unlock:()=>unlockIOS(),redraw:()=>{drawChart();drawArr()},midi:()=>clubMidi(),jump:b=>{if(phase==='play')arrBar=b-1},render:renderOne,
  run:(s,w)=>{want=w||'';newRun(s)},set:(id,nm)=>{G.inst[id]=nm;renderInst()},info:()=>({style:G.style,bpm:G.bpm,inst:Object.assign({},G.inst),phase,level:LEVEL}),
  levels:()=>{const o={};IDS.forEach(id=>{const m=measuredF(id);o[id]=m?m.map(x=>+x.toFixed(3)):null});return o},
  // ---- transport, for the stage view (js/stage.js) ----
  play:()=>{if(!ac){try{initAudio()}catch(e){return false}unlockIOS();setTempo()}if(!playing){resume()}return true},
  isPlaying:()=>playing,
  clock:()=>ac?ac.currentTime:0,
  // what the cue pads judge against: the audio time of the step now sounding and the next one
  beat:()=>({playing,step,nextT,stepDur,T:ac?ac.currentTime:0,bar:gbar}),
  buildNow:()=>buildNow(),
  // next song: a finished track lands on the next downbeat (straight away when paused); during the
  // search it starts a new search, so NEXT keeps whichever mode the set is in
  next:()=>{if(phase!=='play')newRun(fresh());else if(playing)wantNext=true;else nextSong(ac?ac.currentTime:0)},
  // ---- the play-along game (js/rhythm.js) ----
  // The audio time being heard right now: what was scheduled at currentTime reaches the speakers
  // outputLatency later, so notes on screen are drawn against this, not currentTime.
  heard:()=>ac?ac.currentTime-(ac.outputLatency||ac.baseLatency||0):0,
  // the six keys are labelled with the first six degrees of the song's scale
  lanes:()=>[0,1,2,3,4,5].map(d=>NOTE[(G.pc+G.scale[d])%12]),
  // The next n bars as notes to hit, read from the arrangement itself (renderBar is pure): the lead
  // line where there is one, else the arp, the bass, the chord stabs, and the kick's quarter notes.
  // One note per step at most; js/rhythm.js thins them to the difficulty.
  chart:(n=3)=>{
    if(phase!=='play'||!plan||!ac||!playing)return null;
    const k0=step===0?arrBar+1:arrBar,t0=nextT-step*stepDur,out=[],pr=ctx.pat.chords||HOME;
    for(let b=0;b<=n;b++){
      const k=k0+b,pb=plan[((k%plan.length)+plan.length)%plan.length],L=renderBar(ctx.pat,G,pb,k),tb=t0+b*16*stepDur;
      for(let s=0;s<L.gapFrom;s++){
        let lane=-1,part='';
        if(L.lead&&L.lead[s]>=0){lane=((L.lead[s]%7)+7)%7;part='lead'}
        else if(L.arp&&L.arp[s]>=0){lane=L.arp[s];part='arp'}
        else if(L.bass&&L.bass[s]>=0){lane=[0,4,0,2][L.bass[s]]||0;part='bass'}
        else if(L.chordHit&&L.chordHit[s]){lane=pr.roots[L.bi];part='chords'}
        else if(L.v.kick&&L.v.kick[s]&&s%4===0){lane=(s/4)%2?5:0;part='kick'}
        if(lane<0)continue;
        out.push({id:seed+':'+k+':'+s,t:tb+s*stepDur+(s%2?G.swing*stepDur:0),lane:Math.min(5,lane%6),part,s,big:!!pb.big});
      }
    }
    return {seed,bpm:G.bpm,stepDur,notes:out};
  },
  // where the set is, for the HUD: the part being searched, or the bar and section of the track
  // ---- Jev (js/jev.js) ----
  // what Jev may choose from: the engine's own lists, so the model can only name things that exist
  catalog:()=>({styles:STYLES.map(s=>({name:s.name,family:s.fam,sound:s.sig,bpm:s.bpm,modes:s.modes})),
    modes:Object.keys(SCALES),notes:NOTE.slice(),parts:IDS.reduce((o,id)=>{o[id]=Object.keys(LIB(id));return o},{})}),
  now:()=>({style:G.style,family:G.fam,key:G.keyName,mode:G.mode,bpm:G.bpm,swing:+G.swing.toFixed(3),inst:Object.assign({},G.inst),
    seed,want,brief,rounds:setRounds,playing,phase,section:phase==='play'&&plan&&arrBar>=0?plan[arrBar%plan.length].n:null}),
  // the AudioContext has to be made inside a user gesture; Jev's answer arrives after one
  prime:()=>{if(!ac){try{initAudio()}catch(e){return false}unlockIOS();setTempo()}return true},
  // apply a validated change: c = {want, brief, rounds, seed, when:'now'|'next', build:'instant'|'evolve'}
  apply:c=>{
    if(c.want!=null){want=c.want;const sel=$('style');if(sel){sel.value=want;if(sel.value!==want)sel.value=''}try{localStorage.setItem('bl-style2',want)}catch(e){}}
    brief=c.brief||null;
    if(c.rounds){setRounds=c.rounds}
    const s=c.seed||fresh();
    if(c.when==='next'&&phase==='play'&&playing){
      try{pendingSong={seed:s,run:runAll(s,want,brief)}}catch(e){return 'failed'}
      wantNext=true;return 'next'}
    newRun(s);
    if(c.build!=='evolve')buildNow();
    if(ac&&!playing)resume();
    return 'now'},
  where:()=>{const k=phase==='play'&&plan&&arrBar>=0?arrBar%plan.length:-1,st=phase==='search'?stages[qi]:null;
    return{phase,bar:k+1,of:plan?plan.length:0,section:k>=0?plan[k].n:null,
      part:st?{n:qi+1,of:stages.length,name:LAYERS[st.i].name,pass:st.pass}:null,
      round:setRound+1,rounds:setRounds,t:(gbar*16+step)*stepDur,rec:REC?(performance.now()-REC.t0)/1000:null}},
  // ---- the set ----
  // how many times the 72-bar arrangement plays before the next song takes over
  setRounds:n=>{setRounds=Math.max(1,Math.min(20,+n||1));setRound=0;pendingSong=null},
  rounds:()=>({round:setRound,of:setRounds,next:pendingSong?pendingSong.seed:null}),
  record:{start:startRec,stop:stopRec},
  // ---- saved loops (see js/loops.js) ----
  // state() is everything needed to rebuild this run. When every part has been searched, the
  // resolved patterns and the genome go with it, so the take is frozen against later code edits.
  state:()=>{const done=IDS.every(id=>!!ctx.pat[id]);
    return{seed,want,style:G.style,key:G.keyName,bpm:G.bpm,inst:Object.assign({},G.inst),
      genome:done?G:null,pat:done?ctx.pat:null}},
  // load() takes a snapshot when the loop has one, otherwise it replays the search from the seed.
  load:st=>{if(!st)return false;
    if(st.pat&&(st.G||st.genome))return loadSnapshot({seed:st.seed,want:st.want||'',inst:st.inst||{},G:st.G||st.genome,pat:st.pat});
    want=st.want||'';const sel=$('style');if(sel){sel.value=want;if(sel.value!==want){want='';sel.value=''}}try{localStorage.setItem('bl-style2',want)}catch(e){}newRun(st.seed);
    if(st.inst)for(const id in st.inst){const nm=st.inst[id];if(LIB(id)&&LIB(id)[nm])G.inst[id]=nm}renderInst();return true},
  // midi() needs the finished search: from a snapshot as it was saved, otherwise rebuilt from the seed.
  midiFor:st=>{const keep={seed,G,ctx,plan};try{
      if(st.pat&&(st.G||st.genome)){G=st.G||st.genome;ctx={G,pat:st.pat,pass:2,F:F0};plan=makePlan(G);seed=st.seed}
      else{const run=runAll(st.seed,st.want||'');G=run.G;ctx=run.ctx;plan=makePlan(G);seed=st.seed}
      if(st.inst)for(const id in st.inst){const nm=st.inst[id];if(LIB(id)&&LIB(id)[nm])G.inst[id]=nm}
      return clubMidi()}finally{seed=keep.seed;G=keep.G;ctx=keep.ctx;plan=keep.plan}}};

newRun(fresh());
requestAnimationFrame(frame);
})();
