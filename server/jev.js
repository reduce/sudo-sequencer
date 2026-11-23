// Jev's brain, on the server. Jev (typesafe/jev-1.13 on OpenRouter) is a System One model: it
// does not write text. It reads a state and answers typed questions (Choice, Score, Noul) with
// calibrated probabilities. So this file asks one request's worth of narrow questions about what the
// listener typed (which style, which mood, faster or slower, which sounds), keeps only the answers
// Jev is confident about, reads the things that are better read by code (a BPM number, a round
// count), and writes the reply itself from what was actually decided.
// The browser only sends what the user typed and what is playing; it never sees the key.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const KEYS=['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const KEY_ALIAS={'DB':1,'D♭':1,'C♯':1,'D#':3,'D♯':3,'E♭':3,'F♯':6,'GB':6,'G♭':6,'G#':8,'G♯':8,'A♭':8,'A#':10,'A♯':10,'B♭':10,'CB':11,'E#':5,'FB':4,'B#':0};

// The engine's own lists, read from js/genome.js, which is pure (no DOM, no audio). Jev can only
// name a style or a sound that the synth actually has.
export function loadCatalog(genomePath){
  const code=readFileSync(genomePath,'utf8');
  const out=vm.runInNewContext(code+'\n;({STYLES,SCALES,NOTE,IDS,parts:IDS.reduce((o,id)=>{o[id]=Object.keys(LIB(id));return o},{})})',{Math},{timeout:2000});
  return {
    styles:out.STYLES.map(s=>({name:s.name,family:s.fam,sound:s.sig,bpm:s.bpm.slice(),modes:s.modes.slice()})),
    modes:Object.keys(out.SCALES),
    parts:out.parts
  };
}

// ---- the questions ----
// Every Choice has an option that means "nothing asked", so Jev is never forced into a change.
const MOODS={
  keep:{mode:null,say:null,text:'The request does not ask for a different mood, colour or feeling'},
  bright:{mode:'major',say:'bright',text:'Happy, bright, sunny, euphoric, feel-good, summery'},
  uplifting:{mode:'Mixolydian',say:'uplifting',text:'Uplifting and open but with an edge, anthemic, bluesy, rock-ish'},
  soulful:{mode:'Dorian',say:'soulful',text:'Soulful, warm, jazzy, smooth, sexy, late-night groove'},
  minor:{mode:'natural minor',say:'moody',text:'Moody, emotional, melancholic, serious, classic minor'},
  dark:{mode:'Phrygian',say:'dark',text:'Dark, sinister, hypnotic, tense, heavy, industrial, menacing'},
  dramatic:{mode:'harmonic minor',say:'dramatic',text:'Dramatic, exotic, cinematic, mysterious, eastern'}
};
const SWING={keep:{v:null,text:'The request does not mention groove, shuffle, swing or straightness'},
  straight:{v:0,text:'Straight, mechanical, rigid, driving, robotic'},
  light:{v:.08,text:'A little groove or bounce'},
  heavy:{v:.16,text:'Heavy swing, shuffle, loose, funky, groovy'}};
const TEMPO=['Much slower: a big drop in tempo','Slower, calmer, more relaxed','Keep the tempo as it is','Faster, more energy','Much faster: a big jump in tempo'];

function questions(cat){
  const q={
    intent:{type:'choice',instructions:'What does the listener want from the DJ?',criteria:{
      change:'Different or new music: a genre, mood, moment, tempo, sound, or just another song',
      question:'To know what is playing right now (the track, key, tempo or sounds)',
      chat:'Something not about the music: a greeting, small talk, or an unrelated request'}},
    style:{type:'choice',instructions:'Which style of electronic music fits the request best? Scenes, moments and moods count, not only genre names.',
      criteria:Object.assign({keep:'The request does not ask for a different style or genre (it only changes tempo, mood, a sound, or asks for another song)'},
        Object.fromEntries(cat.styles.map(s=>[s.name,s.family+', '+s.bpm[0]+'–'+s.bpm[1]+' BPM: '+s.sound])))},
    mood:{type:'choice',instructions:'Which mood or colour does the request ask for?',criteria:Object.fromEntries(Object.entries(MOODS).map(([k,v])=>[k,v.text]))},
    tempo:{type:'score',instructions:'Compared with what is playing now, how does the request want the tempo to change?',criteria:TEMPO},
    swing:{type:'choice',instructions:'What kind of rhythm feel does the request ask for?',criteria:Object.fromEntries(Object.entries(SWING).map(([k,v])=>[k,v.text]))},
    key:{type:'choice',instructions:'Does the request name a musical key (the tonic note)?',
      criteria:Object.assign({none:'No key is named'},Object.fromEntries(KEYS.map(k=>[k,'The request names the key of '+k])))},
    // screens: the detailed questions above only count when one of these is a clear yes, so a
    // request like "faster" cannot also change the style, the mood and the groove
    asks_style:{type:'noul',instructions:'The request names a genre or style of music, or a scene, place or time that implies one (a warehouse, a beach at sunrise, a rave, 4am)'},
    asks_mood:{type:'noul',instructions:'The request describes how the music should feel: a mood, emotion or colour such as dark, happy, warm, sad, epic or dreamy'},
    asks_groove:{type:'noul',instructions:'The request mentions rhythm feel: swing, groove, shuffle, bounce, funk, or being straight or rigid'},
    asks_tempo:{type:'noul',instructions:'The request asks for a different speed or energy: faster, slower, calmer, harder, more or less energy, or a BPM'},
    now:{type:'noul',instructions:'The listener explicitly wants the change right now, cutting the current song (now, immediately, skip, switch it now)'},
    evolve:{type:'noul',instructions:'The listener wants to watch or hear the track being built or evolved part by part'}
  };
  for(const id of Object.keys(cat.parts)){
    q['sound_'+id]={type:'choice',instructions:'Does the request ask for a particular '+id+' sound? Match descriptive words to these names.',
      criteria:Object.assign({none:'The request does not ask for a particular '+id+' sound'},Object.fromEntries(cat.parts[id].map(n=>[n,n+' '+id])))};
  }
  return q;
}

// ---- turning answers into a brief ----
// Only confident answers move anything. The cut-offs are deliberately conservative: a vague
// request should change little and say so, not guess.
const pick=(a,type)=>a&&a.type===type?a:null;
function topProb(a){return a&&a.probabilities&&a.choice!=null?Number(a.probabilities[a.choice])||0:0}

export function decideBrief(answers,cat,now,text){
  const A=answers||{};
  const intent=pick(A.intent,'choice');
  const kind=intent&&intent.choice?intent.choice:'chat';
  const out={kind,args:null,said:{}};
  if(kind!=='change')return out;
  const yes=(id,cut=.5)=>{const a=pick(A[id],'noul');return !!a&&Number(a.noul)>=cut};

  const prev=now.brief||{};
  const styles=cat.styles.map(s=>s.name);
  // style: a confident style; a vague one becomes its family; "keep" keeps the current style
  let style=null,family=null;
  const st=pick(A.style,'choice');
  if(yes('asks_style')&&st&&st.choice&&st.choice!=='keep'&&styles.includes(st.choice)){
    if(topProb(st)>=.45)style=st.choice;
    else{
      const fam={};
      for(const s of cat.styles)fam[s.family]=(fam[s.family]||0)+(Number(st.probabilities[s.name])||0);
      const best=Object.entries(fam).sort((x,y)=>y[1]-x[1])[0];
      if(best&&best[1]>=.6)family=best[0];else style=st.choice;
    }
  }
  const styleChanged=(style&&style!==now.style)||!!family;
  // a new style starts a fresh brief; otherwise this is an edit of the current one
  const args=styleChanged?{style,family,instruments:{}}:{style:now.style||null,bpm:prev.bpm,key:prev.key,mode:prev.mode,swing:prev.swing,instruments:Object.assign({},prev.inst)};
  const said=out.said;
  if(styleChanged)said.style=style||family.toLowerCase();

  // tempo: a number in the text wins; otherwise a confident nudge from the current tempo
  const m=/(\d{2,3})\s*(?:bpm|beats)/i.exec(text)||/\bat\s+(\d{2,3})\b/i.exec(text);
  if(m){args.bpm=+m[1];said.bpm=args.bpm}
  else{
    const tp=pick(A.tempo,'score');
    if(yes('asks_tempo')&&tp&&Number.isFinite(tp.score)&&(tp.confidence||0)>=.35&&Math.abs(tp.score-2)>=.5){
      const s=style?cat.styles.find(x=>x.name===style):null;
      const base=styleChanged?(s?Math.round((s.bpm[0]+s.bpm[1])/2):null):(args.bpm||now.bpm);
      if(base){args.bpm=Math.round(base+(tp.score-2)*6);said.bpm=args.bpm;said.tempo=tp.score>2?'faster':'slower'}
    }
  }
  const md=pick(A.mood,'choice');
  if(yes('asks_mood')&&md&&MOODS[md.choice]&&MOODS[md.choice].mode&&topProb(md)>=.45){args.mode=MOODS[md.choice].mode;said.mood=MOODS[md.choice].say}
  const k=pick(A.key,'choice');
  if(k&&k.choice&&k.choice!=='none'&&topProb(k)>=.6){args.key=k.choice;said.key=k.choice}
  const sw=pick(A.swing,'choice');
  if(yes('asks_groove')&&sw&&SWING[sw.choice]&&SWING[sw.choice].v!=null&&topProb(sw)>=.45){args.swing=SWING[sw.choice].v;said.swing=sw.choice}
  said.sounds=[];
  for(const id of Object.keys(cat.parts)){
    const a=pick(A['sound_'+id],'choice');
    if(a&&a.choice&&a.choice!=='none'&&topProb(a)>=.5){args.instruments[id]=a.choice;said.sounds.push(a.choice+' '+id)}
  }
  const r=/(\d{1,2})\s*(?:rounds?|times|loops)/i.exec(text);
  if(r){args.rounds=+r[1];said.rounds=args.rounds}
  const nw=pick(A.now,'noul'),ev=pick(A.evolve,'noul');
  args.when=!now.playing||(nw&&nw.noul>=.75)?'now':'next';
  args.build=ev&&ev.noul>=.6?'evolve':'instant';
  out.args=args;
  return out;
}

// ---- Jev's voice ----
// Jev decides; the words come from here, and only ever name what was decided.
const OPEN=['Dropping into','Switching to','Bringing in','Taking it into','Lining up'];
function replyFor(d,now,change){
  if(d.kind==='question'){
    if(!now.style)return 'Nothing is playing yet. Press START, or tell me what you want to hear.';
    return 'Now playing: '+now.style+(now.key?' in '+now.key:'')+(now.bpm?' at '+now.bpm+' BPM':'')+(now.section?', in the '+now.section.toLowerCase():'')+'.';
  }
  if(d.kind!=='change')return 'I pick the music. Give me a genre, a mood, a moment or a tempo: “warm deep house for sunset”, “darker”, “faster”.';
  const s=d.said,bits=[];
  if(s.mood&&!s.style)bits.push(s.mood);
  if(s.key)bits.push('in '+s.key);
  if(s.bpm)bits.push('at '+s.bpm+' BPM');
  if(s.swing)bits.push(s.swing==='straight'?'dead straight':s.swing==='heavy'?'with a heavy swing':'with a little swing');
  const sounds=s.sounds&&s.sounds.length?', '+s.sounds.join(' and ')+' up front':'';
  const rounds=s.rounds?', '+s.rounds+' rounds a song':'';
  const what=s.style||(s.tempo||s.mood||s.key||s.swing||(s.sounds&&s.sounds.length)?(now.style||'the set'):null);
  if(!what)return 'Spinning a fresh one in the same vibe.';
  const verb=OPEN[(change.seedHint||0)%OPEN.length];
  const head=s.style?verb+' '+(s.mood?s.mood+' ':'')+what:'Same '+what+', now';
  return head+(bits.length?(s.style?', ':' ')+bits.join(', '):'')+sounds+rounds+'.';
}

// The model's arguments are untrusted. Map every value onto the catalog or drop it with a note.
export function sanitize(a,cat){
  const notes=[];
  const ci=(list,v)=>{if(typeof v!=='string')return null;const s=v.trim().toLowerCase();return list.find(x=>x.toLowerCase()===s)||null};
  const num=(v,lo,hi,int)=>{const n=Number(v);if(v==null||v===''||!Number.isFinite(n))return null;const c=Math.max(lo,Math.min(hi,n));if(c!==n)notes.push(v+' clamped to '+c);return int?Math.round(c):c};
  const out={brief:{}};
  const styleNames=cat.styles.map(s=>s.name),fams=[...new Set(cat.styles.map(s=>s.family))];
  if(a.style!=null){const s=ci(styleNames,a.style);if(s)out.want=s;else notes.push('unknown style '+a.style)}
  if(out.want==null){const f=ci(fams,a.family);out.want=f?'fam:'+f:''}
  const bpm=num(a.bpm,80,175,true);if(bpm!=null)out.brief.bpm=bpm;
  if(a.key!=null){const k=String(a.key).trim().toUpperCase();let pc=KEYS.findIndex(x=>x.toUpperCase()===k);if(pc<0&&KEY_ALIAS[k]!=null)pc=KEY_ALIAS[k];if(pc>=0)out.brief.key=pc;else notes.push('unknown key '+a.key)}
  if(a.mode!=null){let m=ci(cat.modes,a.mode);if(!m&&/^minor$/i.test(String(a.mode)))m='natural minor';if(m)out.brief.mode=m;else notes.push('unknown mode '+a.mode)}
  const sw=num(a.swing,0,.3,false);if(sw!=null)out.brief.swing=sw;
  if(a.instruments&&typeof a.instruments==='object'&&!Array.isArray(a.instruments)){
    const inst={};
    for(const id of Object.keys(a.instruments)){
      const v=a.instruments[id];if(v==null)continue;
      if(!cat.parts[id]){notes.push('unknown part '+id);continue}
      const nm=ci(cat.parts[id],v);if(nm)inst[id]=nm;else notes.push('no '+id+' called '+v);
    }
    if(Object.keys(inst).length)out.brief.inst=inst;
  }
  if(!Object.keys(out.brief).length)out.brief=null;
  const r=num(a.rounds,1,20,true);if(r!=null)out.rounds=r;
  const sd=num(a.seed,1,999999,true);if(sd!=null)out.seed=sd;
  out.when=a.when==='now'?'now':'next';
  out.build=a.build==='evolve'?'evolve':'instant';
  return {change:out,notes};
}

// What the browser may send. Everything is bounded, so a request cannot be used to smuggle a
// long prompt to the model on our key.
export function readRequest(body){
  if(!body||typeof body!=='object')throw new Error('expected a JSON body');
  const text=typeof body.message==='string'?body.message.trim():'';
  if(!text)throw new Error('message is empty');
  if(text.length>500)throw new Error('message is longer than 500 characters');
  const history=Array.isArray(body.history)?body.history.slice(-8).filter(m=>m&&(m.role==='user'||m.role==='assistant')&&typeof m.content==='string').map(m=>({role:m.role,content:m.content.slice(0,500)})):[];
  const n=body.now&&typeof body.now==='object'?body.now:{};
  const s=(v,l=60)=>typeof v==='string'?v.slice(0,l):null;
  const inst={};
  if(n.inst&&typeof n.inst==='object')for(const k of Object.keys(n.inst).slice(0,12))inst[s(k,12)]=s(n.inst[k],40);
  const now={style:s(n.style),key:s(n.key),mode:s(n.mode),bpm:Number.isFinite(n.bpm)?n.bpm:null,swing:Number.isFinite(n.swing)?n.swing:null,
    inst,rounds:Number.isFinite(n.rounds)?n.rounds:null,playing:!!n.playing,section:s(n.section,20),
    brief:null};
  // the brief Jev set last time, reduced to its known fields
  const b=n.brief;
  if(b&&typeof b==='object'&&!Array.isArray(b)){
    now.brief={bpm:Number.isFinite(b.bpm)?b.bpm:null,key:Number.isInteger(b.key)?KEYS[((b.key%12)+12)%12]:null,mode:s(b.mode,20),
      swing:Number.isFinite(b.swing)?b.swing:null,inst:{}};
    if(b.inst&&typeof b.inst==='object')for(const k of Object.keys(b.inst).slice(0,12))now.brief.inst[s(k,12)]=s(b.inst[k],40);
  }
  return {text,history,now};
}

export async function askJev({text,history,now},cat,{key,model,fetchImpl=fetch,timeout=20000}){
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),timeout);
  const state={request:text,earlier_requests:history.filter(m=>m.role==='user').slice(-3).map(m=>m.content),
    now_playing:{style:now.style,key:now.key,mode:now.mode,bpm:now.bpm,section:now.section,sounds:now.inst,playing:now.playing}};
  let res;
  try{
    res=await fetchImpl('https://openrouter.ai/api/alpha/decisions',{method:'POST',signal:ctl.signal,
      headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json','X-Title':'Sudo Sequencer'},
      body:JSON.stringify({model,state,questions:questions(cat)})});
  }catch(e){
    throw Object.assign(new Error(e&&e.name==='AbortError'?'The DJ did not answer in time':'could not reach OpenRouter'),{status:504});
  }finally{clearTimeout(timer)}
  let body=null;try{body=await res.json()}catch(e){}
  if(!res.ok){
    const why=body&&body.error&&body.error.message?body.error.message:'HTTP '+res.status;
    throw Object.assign(new Error(res.status===401?'OpenRouter rejected the server key':'OpenRouter: '+why),{status:502});
  }
  const answers=body&&body.answers&&typeof body.answers==='object'?body.answers:null;
  if(!answers)return {reply:'The DJ came back empty. Try that again?',change:null,notes:[]};
  const d=decideBrief(answers,cat,now,text);
  if(d.kind!=='change'||!d.args)return {reply:replyFor(d,now,{}),change:null,notes:[]};
  const {change,notes}=sanitize(d.args,cat);
  return {reply:replyFor(d,now,{seedHint:text.length}),change,notes};
}

export {questions};
