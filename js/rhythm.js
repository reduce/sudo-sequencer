// ---------- play along: an optional rhythm game on six keys ----------
// Notes fall down six lanes to a line, and land on it exactly when the track plays them. They are
// not invented: __bl.chart() reads the coming bars of the arrangement (lead line first, then arp,
// bass, chord stabs, kick) and this file thins them to an even grid. Each lane is labelled with one
// of the first six notes of the song's scale. Pressing a key makes no sound of its own, so a stray
// or late press never lands on top of the track: it only scores and lights the lane.
// Keys: S D F J K L, or tap. Easy on purpose: one note per beat at most tempos, and a hit within
// 200 ms counts. Combos of 10, 25, 50 and 100 raise the multiplier and set off the effects. G or the PLAY ALONG button shows and hides it; nothing else changes.
(function(){
'use strict';
const $=id=>document.getElementById(id);
const view=$('hGame2'),btn=$('hGame'),cv=$('gHighway'),keysEl=$('gKeys'),judgeEl=$('gJudge');
if(!view||!cv)return;
const KEYS=['s','d','f','j','k','l'];
const LANE_COL=['#ff5470','#ffb03a','#ffe45e','#3ff0d0','#3aa0ff','#ff4fd8'];
const TRAVEL=2.1;                      // seconds a note takes from the top to the line
// Close, not exact: a hit within 70 ms is PERFECT, and anything within 200 ms still counts.
const WIN={perfect:.07,great:.13,good:.2};
const PTS={perfect:300,great:200,good:100};
// combo tiers: each one raises the multiplier, the highway's glow and the club's lights
const TIERS=[{at:10,name:'ON FIRE'},{at:25,name:'UNSTOPPABLE'},{at:50,name:'FEVER'},{at:100,name:'LEGENDARY'}];
const tierOf=c=>TIERS.reduce((t,x,i)=>c>=x.at?i+1:t,0);
let on=false,seed=null,lastFetch=0,lastNames='',raf=0,shake=0;
const sparks=[],rings=[];               // hit effects, drawn on the highway
const notes=new Map();                 // id -> {t,lane,state:null|'perfect'|'great'|'good'|'miss',at}
// every note id ever charted for this song: the chart is re-read every 180 ms and still holds the
// bar being played, so a note that was hit and cleared away must not come back as a fresh one
const charted=new Set();
const flash=[0,0,0,0,0,0],held=[false,false,false,false,false,false];
const burstEl=$('gBurst'),hwEl=cv.parentNode;
const S={score:0,combo:0,best:0,perfect:0,great:0,good:0,miss:0,hype:0};

// ---------------------------------------------------------------- the keys
const keyBtns=KEYS.map((k,i)=>{
  const b=document.createElement('button');
  b.type='button';b.className='pk';b.dataset.lane=i;b.style.setProperty('--c',LANE_COL[i]);
  b.innerHTML='<b>·</b><kbd>'+k.toUpperCase()+'</kbd>';
  b.addEventListener('pointerdown',e=>{e.preventDefault();press(i)});
  b.addEventListener('pointerup',()=>release(i));
  b.addEventListener('pointerleave',()=>release(i));
  keysEl.append(b);
  return b;
});
function names(){
  const bl=window.__bl;if(!bl||!bl.lanes)return;
  const n=bl.lanes(),j=n.join();
  if(j===lastNames)return;
  lastNames=j;
  keyBtns.forEach((b,i)=>{b.querySelector('b').textContent=n[i];b.setAttribute('aria-label','Play '+n[i]+' (key '+KEYS[i].toUpperCase()+')')});
}

window.addEventListener('keydown',e=>{
  if(!on||e.repeat||e.metaKey||e.ctrlKey||e.altKey||e.target.matches('input,select,textarea'))return;
  const i=KEYS.indexOf(e.key.toLowerCase());
  if(i<0)return;
  e.preventDefault();press(i);
});
window.addEventListener('keyup',e=>{const i=KEYS.indexOf(e.key.toLowerCase());if(i>=0)release(i)});

// ---------------------------------------------------------------- judging
function press(lane){
  held[lane]=true;keyBtns[lane].classList.add('down');flash[lane]=1;
  const bl=window.__bl;if(!bl)return;
  const now=bl.heard();
  let best=null,bd=1;
  for(const n of notes.values()){
    if(n.lane!==lane||n.state)continue;
    const d=Math.abs(n.t-now);
    if(d<bd){bd=d;best=n}
  }
  if(!best||bd>WIN.good)return;          // a press with nothing near it costs nothing
  const grade=bd<=WIN.perfect?'perfect':bd<=WIN.great?'great':'good';
  best.state=grade;best.at=now;
  const before=tierOf(S.combo);
  S[grade]++;S.combo++;S.best=Math.max(S.best,S.combo);
  const tier=tierOf(S.combo);
  S.score+=PTS[grade]*(1+tier);
  S.hype=Math.min(100,S.hype+(grade==='perfect'?7:grade==='great'?5:3));
  burst(lane,grade,tier);
  judge(grade);
  if(tier>before)milestone(tier);
  else if(S.combo>100&&S.combo%50===0)milestone(tier);
}
function release(lane){held[lane]=false;keyBtns[lane].classList.remove('down')}
// a miss only breaks the combo: no score taken, a small dent in the hype
function miss(n){
  n.state='miss';S.miss++;
  if(S.combo>=10)shake=.35;
  S.combo=0;S.hype=Math.max(0,S.hype-4);
  judge('miss');
}
// sparks and a shockwave ring on the line, bigger for a PERFECT and for a higher tier
function burst(lane,grade,tier){
  const w=cv.clientWidth,h=cv.clientHeight,lw=w/6,x=lane*lw+lw/2,y=h-14,col=LANE_COL[lane];
  const n=(grade==='perfect'?14:grade==='great'?9:5)+tier*5;
  for(let i=0;i<n;i++){
    const a=-Math.PI*(.1+Math.random()*.8),v=90+Math.random()*(160+tier*60);
    sparks.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,life:1,col:Math.random()<.3?'#fff':col,size:1.5+Math.random()*2.5});
  }
  rings.push({x,y,r:6,life:1,col:grade==='perfect'?'#fff':col,grow:110+tier*40});
  if(sparks.length>400)sparks.splice(0,sparks.length-400);
}
// a new tier: a burst across the highway, the club flashes, the multiplier steps up
function milestone(tier){
  const t=TIERS[Math.max(0,tier-1)];
  burstEl.textContent=S.combo+' COMBO · '+t.name+' · ×'+(1+tier);
  burstEl.className='gburst t'+tier;
  void burstEl.offsetWidth;burstEl.classList.add('show');
  for(let i=0;i<6;i++)burst(i,'perfect',tier);
  shake=.25;
  const st=window.__stage;
  if(st&&st.pulse)['kick','clap','hat','lead','arp','chords'].forEach(id=>st.pulse(id));
  S.hype=Math.min(100,S.hype+15);
}
function judge(g){
  judgeEl.textContent=g.toUpperCase()+(g!=='miss'&&S.combo>4?' ×'+S.combo:'');
  judgeEl.className='gjudge '+g;
  void judgeEl.offsetWidth;judgeEl.classList.add('show');
}

// ---------------------------------------------------------------- chart
function fetchChart(){
  const bl=window.__bl,c=bl&&bl.chart?bl.chart(3):null;
  if(!c)return;
  if(c.seed!==seed){                     // a new song: what was charted for the old one is wrong now
    seed=c.seed;charted.clear();
    for(const [id,n] of notes)if(!n.state)notes.delete(id);
  }
  const now=window.__bl.heard();
  // an even grid the hands can follow: one note per beat, eighths only below 118 BPM
  const gap=c.bpm>=118?4:2;
  for(const n of c.notes){
    if(n.s%gap!==0||charted.has(n.id))continue;
    charted.add(n.id);
    if(n.t<now+.1)continue;              // already at the line when first seen: not fair to judge
    notes.set(n.id,{t:n.t,lane:n.lane,state:null,at:0});
  }
}

// ---------------------------------------------------------------- drawing
function draw(){
  raf=requestAnimationFrame(draw);
  if(!on||document.hidden)return;
  const bl=window.__bl;if(!bl)return;
  const now=bl.heard(),t=performance.now();
  if(t-lastFetch>180){lastFetch=t;fetchChart();names()}
  const dpr=Math.min(window.devicePixelRatio||1,2),w=cv.clientWidth,h=cv.clientHeight;
  if(!w||!h)return;
  if(cv.width!==Math.round(w*dpr)||cv.height!==Math.round(h*dpr)){cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr)}
  const c=cv.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);
  const lw=w/6,hitY=h-14,playing=bl.isPlaying&&bl.isPlaying(),tier=tierOf(S.combo);
  hwEl.dataset.tier=tier;
  if(shake>0){const k=shake*10;c.translate((Math.random()-.5)*k,(Math.random()-.5)*k);shake=Math.max(0,shake-.02)}
  // lanes
  for(let i=0;i<6;i++){
    const x=i*lw;
    const g=c.createLinearGradient(0,0,0,h);
    g.addColorStop(0,'rgba(10,20,28,0)');g.addColorStop(1,'rgba(10,20,28,.55)');
    c.fillStyle=g;c.fillRect(x+1,0,lw-2,h);
    if(flash[i]>0){c.fillStyle=LANE_COL[i];c.globalAlpha=flash[i]*.22;c.fillRect(x+1,0,lw-2,h);c.globalAlpha=1;flash[i]=Math.max(0,flash[i]-.08)}
  }
  // the line
  c.fillStyle='rgba(223,246,255,.85)';c.fillRect(0,hitY,w,2);
  for(let i=0;i<6;i++){c.strokeStyle=LANE_COL[i];c.globalAlpha=held[i]?1:.45;c.lineWidth=2;
    c.strokeRect(i*lw+lw*.18,hitY-6,lw*.64,14);c.globalAlpha=1}
  // notes
  for(const [id,n] of notes){
    const dt=n.t-now;
    if(!n.state&&dt<-WIN.good)miss(n);
    if(n.state&&now-(n.state==='miss'?n.t:n.at)>.35){notes.delete(id);continue}
    if(dt>TRAVEL)continue;
    const y=hitY-(dt/TRAVEL)*hitY,x=n.lane*lw+lw*.14,nw=lw*.72;
    if(n.state&&n.state!=='miss'){                 // a hit blooms on the line
      const k=(now-n.at)/.35;c.globalAlpha=Math.max(0,1-k);c.fillStyle='#fff';
      c.fillRect(x-k*8,hitY-6-k*8,nw+k*16,14+k*16);c.globalAlpha=1;continue}
    if(tier>=3&&!n.state){                          // fever: notes leave a trail
      const g=c.createLinearGradient(0,y-60,0,y);g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,LANE_COL[n.lane]);
      c.globalAlpha=.35;c.fillStyle=g;c.fillRect(x+nw*.2,y-60,nw*.6,54);c.globalAlpha=1}
    c.globalAlpha=n.state==='miss'?.25:1;
    c.fillStyle=LANE_COL[n.lane];c.shadowColor=LANE_COL[n.lane];c.shadowBlur=n.state?0:14+tier*6;
    c.fillRect(x,y-8,nw,16);c.shadowBlur=0;
    c.fillStyle='rgba(255,255,255,.55)';c.fillRect(x,y-8,nw,4);c.globalAlpha=1;
  }
  // effects
  const fdt=1/60;
  for(let i=rings.length-1;i>=0;i--){const r=rings[i];r.r+=r.grow*fdt;r.life-=fdt*2.4;
    if(r.life<=0){rings.splice(i,1);continue}
    c.globalAlpha=r.life;c.strokeStyle=r.col;c.lineWidth=2+r.life*3;c.beginPath();c.arc(r.x,r.y,r.r,0,Math.PI*2);c.stroke()}
  for(let i=sparks.length-1;i>=0;i--){const p=sparks[i];p.x+=p.vx*fdt;p.y+=p.vy*fdt;p.vy+=380*fdt;p.life-=fdt*1.6;
    if(p.life<=0){sparks.splice(i,1);continue}
    c.globalAlpha=p.life;c.fillStyle=p.col;c.fillRect(p.x,p.y,p.size,p.size)}
  c.globalAlpha=1;
  if(!playing){c.fillStyle='rgba(223,246,255,.7)';c.font='600 12px "Chakra Petch", monospace';c.textAlign='center';
    c.fillText('PRESS START, THEN HIT THE NOTES ON THE LINE',w/2,h*.45)}
  // stats
  S.hype=Math.max(0,S.hype-.05);
  const judged=S.perfect+S.great+S.good+S.miss;
  $('gScore').textContent=S.score.toLocaleString('en-US');
  $('gCombo').textContent=S.combo+(tier?' ×'+(1+tier):'');
  $('gAcc').textContent=judged?Math.round((S.perfect+S.great*.8+S.good*.5)/judged*100)+'%':'—';
  $('gHype').style.width=S.hype.toFixed(1)+'%';
  if(window.__stage&&window.__stage.setBoost)window.__stage.setBoost(S.hype/100);
}

function toggle(v){
  on=v==null?!on:!!v;
  view.hidden=!on;
  // the chat box steps aside while the game is open, and comes back when it closes
  document.body.classList.toggle('game-on',on);
  if(on&&document.activeElement&&document.activeElement.id==='jevIn')document.activeElement.blur();
  if(window.__hud&&window.__hud.measure)requestAnimationFrame(window.__hud.measure);
  btn.setAttribute('aria-pressed',String(on));
  if(on){names();lastFetch=0;if(!raf)raf=requestAnimationFrame(draw)}
  else{notes.clear();charted.clear();sparks.length=0;rings.length=0;if(window.__stage&&window.__stage.setBoost)window.__stage.setBoost(0)}
}

window.__rhythm={toggle,on:()=>on,state:S,notes:()=>notes.size};
})();
