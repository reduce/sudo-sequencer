// ---------- HUD ----------
// The stage is full screen and the old views are off-screen but still live: this file drives the
// top bar (what is playing, where the set is, the song actions), the part meters, the beat rail,
// START, and the setup drawer, into which it moves the engine's real controls (style, instruments,
// loops, MIDI/WAV). The play-along game is js/rhythm.js; Jev is js/jev.js.
(function(){
'use strict';
const $=id=>document.getElementById(id);
const IDS=['kick','clap','hat','ohat','perc','bass','chords','pad','arp','lead'];
const el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e};
const hud={
  play:$('hPlay'),next:$('hNext'),build:$('hBuild'),rec:$('hRec'),game:$('hGame'),
  style:$('hStyle'),key:$('hKey'),bpm:$('hBpm'),seed:$('hSeed'),rounds:$('hRounds'),
  bar:$('hBar'),barL:$('hBarL'),sect:$('hSect'),sectL:$('hSectL'),round:$('hRound'),clock:$('hClock'),
  rail:$('hRail'),meters:$('hMeters'),toasts:$('hToasts'),
  panel:$('hPanel'),face:$('hFace'),run:$('hRun'),top:$('hTop'),dock:$('hDock')
};

// The top bar and the dock change height as they wrap (phone portrait, landscape, a long track
// name). Everything else is placed against these two numbers instead of guessed offsets.
const root=document.documentElement;
function measure(){
  root.style.setProperty('--top-h',Math.ceil(hud.top.getBoundingClientRect().height)+'px');
  root.style.setProperty('--dock-h',Math.ceil(hud.dock.getBoundingClientRect().height)+'px');
}
if(window.ResizeObserver){const ro=new ResizeObserver(measure);ro.observe(hud.top);ro.observe(hud.dock)}
window.addEventListener('resize',measure);
measure();

// meters, one per part, in the same colour the stage uses
const MET={};
IDS.forEach(id=>{
  const row=el('div','mrow');row.style.setProperty('--c','var(--'+id+')');row.title=id;
  const bar=el('div','mb'),fill=el('i');
  bar.append(fill);
  row.append(el('span',null,id),bar);
  hud.meters.append(row);
  MET[id]={row,fill,last:-1};
});

// beat rail
const RAIL=[];
for(let i=0;i<16;i++){const c=el('i',i%4===0?'q':'');hud.rail.append(c);RAIL.push(c)}

// ---------------------------------------------------------------- toasts
function toast(text,kind){
  const t=el('div','toast'+(kind?' '+kind:''),text);
  hud.toasts.append(t);
  setTimeout(()=>{t.style.opacity='0';t.style.transition='opacity .3s';setTimeout(()=>t.remove(),320)},2100);
  while(hud.toasts.children.length>3)hud.toasts.firstChild.remove();
}

// ---------------------------------------------------------------- keys
window.addEventListener('keydown',e=>{
  if(e.target.matches('input,select,textarea')||e.metaKey||e.ctrlKey||e.altKey)return;
  const k=e.key.length===1?e.key.toLowerCase():e.key;
  if(k===' '){e.preventDefault();hud.play.click();return}
  if(k==='Tab'){e.preventDefault();togglePanel();return}
  if(k==='Escape'){if(!hud.panel.hidden)togglePanel(false);return}
  if(window.__rhythm&&window.__rhythm.on()&&'sdfjkl'.indexOf(k)>=0)return;   // the game's keys
  if(k==='r'){e.preventDefault();hud.rec.click();return}
  if(k==='b'){e.preventDefault();if(!hud.build.disabled)hud.build.click();return}
  if(k==='n'){e.preventDefault();hud.next.click();return}
  if(k==='g'){e.preventDefault();hud.game.click();return}
});

// ---------------------------------------------------------------- phone menu
// On a phone the top-right actions fold into a dropdown (css/app.css). It closes after a choice,
// on a tap outside it, and on Escape.
const menuBtn=$('hMenu');
function menu(open){
  const show=open==null?!hud.top.classList.contains('open'):!!open;
  hud.top.classList.toggle('open',show);
  menuBtn.setAttribute('aria-expanded',String(show));
}
menuBtn.addEventListener('click',e=>{e.stopPropagation();menu()});
$('hActions').addEventListener('click',e=>{if(e.target.closest('.act'))menu(false)});
document.addEventListener('pointerdown',e=>{if(hud.top.classList.contains('open')&&!e.target.closest('#hTop'))menu(false)});
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&hud.top.classList.contains('open')){menu(false);menuBtn.focus()}});

// ---------------------------------------------------------------- panel
function togglePanel(on){
  const show=on==null?hud.panel.hidden:!!on;
  hud.panel.hidden=!show;
  $('hSys').setAttribute('aria-pressed',String(show));
}
$('hSys').addEventListener('click',()=>togglePanel());
$('hPanelX').addEventListener('click',()=>togglePanel(false));

// ---------------------------------------------------------------- views
// The stage is the app: the club view's markup stays off-screen as the engine's handles.
function viewMode(){
  const sv=$('stageView'),cv=$('clubView');
  if(sv)sv.hidden=false;
  if(cv)cv.hidden=true;
  if(window.__stage&&window.__stage.setActive)window.__stage.setActive(true);
}
window.addEventListener('hashchange',viewMode);
viewMode();

// ---------------------------------------------------------------- legacy wiring
// Every real control still lives in the off-screen DOM. Moving a node keeps its listeners,
// so the drawer gets the genuine engine controls instead of a parallel implementation.
function move(id,into){const n=$(id),h=$(into);if(n&&h){h.append(n);return true}return false}
move('style','mStyle');
move('dna','mDna');
move('inst','mInst');
move('instSub','mInstSub');
move('status','mStatus');
move('stat2','mStatus');

const styleSel=$('style');
function cycleStyle(){
  if(!styleSel||!styleSel.options.length)return;
  styleSel.selectedIndex=(styleSel.selectedIndex+1)%styleSel.options.length;
  styleSel.dispatchEvent(new Event('change',{bubbles:true}));
}

$('hStyleBtn').addEventListener('click',cycleStyle);
hud.play.addEventListener('click',()=>$('play').click());
hud.next.addEventListener('click',()=>{if(window.__bl&&window.__bl.next)window.__bl.next()});
hud.build.addEventListener('click',()=>$('build').click());
hud.rec.addEventListener('click',()=>$('cwav').click());
hud.game.addEventListener('click',()=>{if(window.__rhythm)window.__rhythm.toggle()});
hud.rounds.addEventListener('change',()=>{if(window.__bl)window.__bl.setRounds(+hud.rounds.value)});
$('hMidi').addEventListener('click',()=>$('cmidi').click());
$('hWav').addEventListener('click',()=>$('cwav').click());

$('hLoopSave').addEventListener('click',()=>{
  const a=$('hLoopName'),b=$('loopName');
  if(a&&b){b.value=a.value;b.dispatchEvent(new Event('input',{bubbles:true}))}
  $('loopSave').click();
  toast('LOOP SAVED');
});
$('hLoopExport').addEventListener('click',()=>$('loopExport').click());
$('hLoopImport').addEventListener('click',()=>$('loopImport').click());
// loops.js re-renders #loopList by id on every save, so move the list element itself into the
// drawer once: it then re-renders in place, with the row listeners loops.js attached intact.
move('loopList','hLoops');

// ---------------------------------------------------------------- sync
const pad2=n=>String(n).padStart(2,'0');
const mmss=s=>pad2(Math.floor(s/60))+':'+pad2(Math.floor(s%60));
function syncInfo(){
  const bl=window.__bl;
  if(!bl||!bl.info)return;
  const info=bl.info(),state=bl.state?bl.state():null;
  hud.style.textContent=info.style||'—';
  hud.bpm.textContent=String(info.bpm||'—');
  if(state){hud.key.textContent=state.key||'—';hud.seed.textContent=String(state.seed||'')}
}
function syncMeters(){
  const lv=window.__stage&&window.__stage.levels?window.__stage.levels():null;
  for(const id of IDS){
    const m=MET[id],pct=Math.round(Math.min(1,lv?(lv[id]||0):0)*100);
    if(pct!==m.last){m.last=pct;m.fill.style.width=pct+'%';m.row.classList.toggle('hit',pct>42)}
  }
}
function syncWhere(){
  const bl=window.__bl,w=bl&&bl.where?bl.where():null;
  if(!w)return;
  if(w.phase==='search'&&w.part){
    hud.sectL.textContent='BUILDING';
    hud.sect.textContent=(w.part.name+(w.part.pass===2?' · 2nd pass':'')).toUpperCase();
    hud.barL.textContent='PART';
    hud.bar.textContent=w.part.n+'/'+w.part.of;
  }else{
    hud.sectL.textContent='SECTION';
    hud.sect.textContent=w.section?w.section.toUpperCase():'—';
    hud.barL.textContent='BAR';
    hud.bar.textContent=w.bar?pad2(w.bar)+'/'+w.of:'—';
  }
  hud.round.textContent=w.round+'/'+w.rounds;
  if(+hud.rounds.value!==w.rounds&&document.activeElement!==hud.rounds){
    if(![...hud.rounds.options].some(o=>+o.value===w.rounds))hud.rounds.append(new Option(String(w.rounds),String(w.rounds)));
    hud.rounds.value=String(w.rounds);
  }
  hud.clock.textContent=mmss(w.t||0);
  hud.build.hidden=w.phase!=='search';
  const rec=w.rec!=null;
  hud.rec.classList.toggle('running',rec);
  hud.rec.querySelector('.lbl').textContent=rec?mmss(w.rec):'REC';
  const on=!!(bl.isPlaying&&bl.isPlaying());
  hud.play.classList.toggle('running',on);
  hud.play.querySelector('.lbl').textContent=on?'PAUSE':'START';
}

let lastInfo=0,lastPoke=0;
function frame(t){
  requestAnimationFrame(frame);
  if(document.hidden)return;
  if(t-lastInfo>600){lastInfo=t;syncInfo()}
  if(t-lastPoke>66){lastPoke=t;syncMeters();syncWhere()}
  const st=window.__stage&&window.__stage.state?window.__stage.state():null;
  if(st)for(let i=0;i<16;i++)RAIL[i].classList.toggle('on',i===st.step);
  const hn=$('headnote');
  if(hn&&hn.textContent&&hn.textContent!==hud.face.textContent)hud.face.textContent=hn.textContent;
  const ln=$('loopNote');
  if(ln&&ln.textContent)hud.run.textContent=ln.textContent;
}

window.__hud={toast,measure};
syncInfo();
requestAnimationFrame(frame);
})();
