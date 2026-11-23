// ---------- Jev, in the browser: the chat box next to START ----------
// What the user types goes to /api/jev on this app's own server (server/index.js), which holds the
// OpenRouter key, builds Jev's prompt, and checks the model's answer against the engine's catalog.
// This file only shows the conversation and hands the checked change to __bl.apply().
(function(){
'use strict';
const $=id=>document.getElementById(id);
const form=$('jev'),input=$('jevIn'),send=$('jevSend'),log=$('jevLog');
if(!form||!window.__bl)return;
const TIMEOUT=50000;
const history=[];                           // the last few turns, so "faster" and "darker" mean something
let busy=false;
if(window.matchMedia&&matchMedia('(max-width:560px)').matches)input.placeholder='Ask the DJ for a vibe';

function say(who,text,kind){
  const p=document.createElement('p');
  p.className='jm '+who+(kind?' '+kind:'');
  const b=document.createElement('b');b.textContent=who==='me'?'You':'DJ';
  const t=document.createElement('span');t.textContent=text;
  p.append(b,t);
  log.append(p);
  while(log.children.length>3)log.firstChild.remove();
  log.hidden=!form.contains(document.activeElement);
  return p;
}

// a static host (no server) has no /api: say so once instead of failing on every message
let online=null;
fetch('/api/jev').then(r=>r.ok?r.json():null).then(j=>{online=!!(j&&j.ready);
  if(!online)input.placeholder='The DJ is offline: run the app with npm start';}).catch(()=>{online=false;input.placeholder='The DJ is offline: run the app with npm start'});

async function ask(text){
  const bl=window.__bl,now=bl.now();
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),TIMEOUT);
  let res,body=null;
  try{
    res=await fetch('/api/jev',{method:'POST',signal:ctl.signal,headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:text,history:history.slice(-8),now})});
    try{body=await res.json()}catch(e){}
  }catch(e){
    say('jev',e&&e.name==='AbortError'?'No answer in time. Try again.':'Cannot reach the server. Is npm start running?','bad');
    return;
  }finally{clearTimeout(timer)}
  if(!res.ok||!body){say('jev',(body&&body.error)||'The server said '+res.status+'.','bad');return}
  history.push({role:'user',content:text},{role:'assistant',content:body.reply});
  while(history.length>8)history.shift();
  if(!body.change){say('jev',body.reply);return}
  const how=bl.apply(body.change);
  const notes=Array.isArray(body.notes)&&body.notes.length?' · skipped: '+body.notes.join('; '):'';
  say('jev',body.reply+(how==='next'?' (on the next bar)':'')+notes,how==='failed'?'bad':'');
}

form.addEventListener('submit',async e=>{
  e.preventDefault();
  const text=input.value.trim().slice(0,500);
  if(!text||busy)return;
  window.__bl.prime();                     // inside the gesture, so the answer can start the audio
  busy=true;form.classList.add('busy');send.disabled=true;input.value='';
  say('me',text);
  const wait=say('jev','…','wait');
  try{await ask(text)}
  catch(err){say('jev','Something broke: '+(err&&err.message||err),'bad')}
  // the box keeps the focus, so the next request can be typed straight away; Escape leaves it
  finally{wait.remove();busy=false;form.classList.remove('busy');send.disabled=false;input.focus()}
});
// the conversation shows only while the box is in use: focusing it brings the last messages back,
// and leaving it (a tap or click anywhere else) hides them
input.addEventListener('focus',()=>{if(log.children.length)log.hidden=false});
input.addEventListener('blur',e=>{if(!form.contains(e.relatedTarget))log.hidden=true});
// the stage swallows pointer events (no default focus change), so a tap there must release the box
document.addEventListener('pointerdown',e=>{if(document.activeElement===input&&!form.contains(e.target))input.blur()},true);
input.addEventListener('keydown',e=>{if(e.key==='Escape'){input.blur();log.hidden=true}});
window.addEventListener('keydown',e=>{
  if(e.key==='/'&&!e.target.matches('input,select,textarea')&&!document.body.classList.contains('game-on')){e.preventDefault();input.focus()}
});
window.__jev={ask:t=>{input.value=t;form.requestSubmit()}};
})();
