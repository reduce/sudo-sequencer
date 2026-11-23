// ---------- the DJ: a VRM avatar dancing a motion library ----------
// A VRM is a glTF with a humanoid rig, so one avatar works with any motion file you drop in.
// A VRMA is a glTF holding a clip for that same humanoid rig, which is why the two never need
// retargeting by hand: @pixiv/three-vrm maps the clip onto whatever bones the avatar has.
//
// Three layers run on the character, in this order:
//   1. the dance   — a whole looping clip, stretched to a whole number of bars and started on a
//                    downbeat, chosen by how hot the room is
//   2. the gesture — a short one-shot emote, played over the dance by weight, facing the camera,
//                    and only when the music drops away
//   3. the face    — expressions and a mouth that is shut unless she is saying something
// Only the first two touch bones, so the third can never fight them.
//
// Every dance is also mirrored through the sagittal plane, an exact geometric mirror of the real
// mocap, which doubles the moves without inventing any. Clips are never cut up: a mocap loop is
// built to loop whole, and a slice of one is a fragment that starts and ends mid-move.
import * as THREE from 'three';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {VRMLoaderPlugin,VRMUtils} from './vendor/vrm/three-vrm.module.js';
import {VRMAnimationLoaderPlugin,createVRMAnimationClip} from './vendor/vrm/three-vrm-animation.module.js';

// The characters that ship with the stage. Every one is CC0, so they can be copied, renamed and
// shipped. Add a line here after dropping a .vrm into assets/vrm/ and it appears in the SYS panel.
export const AVATARS=[
  // SUDO is the default; a missing avatar file is skipped, down this list.
  {id:'sudo',label:'SUDO',url:'assets/vrm/sudo.vrm'},              // Reality(CT-DJ), BlueBlurChamp
  {id:'optimus',label:'Optimus Prime',url:'assets/vrm/optimus.vrm'}, // G1コンボイ, shionpime
  {id:'victoria',label:'Victoria',url:'assets/vrm/dj.vrm'},
  {id:'aurora',label:'Aurora',url:'assets/vrm/aurora.vrm'},
  {id:'orion',label:'Orion',url:'assets/vrm/orion.vrm'},
  {id:'frosty',label:'Frosty',url:'assets/vrm/frosty.vrm'}
];

// The looping mocap the library is built from, and the energy band each one belongs to
// (0 almost still, 3 a drop). Everything else in the library is derived from these.
// wave.vrma and pose.vrma are not dances (one waves at the crowd, one holds still), so they stay
// out of the rotation: a drop spent waving is what made her look like she had stopped dancing.
export const MOTIONS={
  idle:  {src:'assets/vrma/idle.vrma',  energy:0},  // standing, breathing, weight shifting
  bounce:{src:'assets/vrma/bounce.vrma',energy:1},  // a groove that survives a quiet section
  dance: {src:'assets/vrma/dance.vrma', energy:2},  // the real thing
  spin:  {src:'assets/vrma/spin.vrma',  energy:3}   // a drop
};

// Which moves a heat band dances. The heat is the stage's 0..1 read of the room.
const POOLS=[
  ['idle','bounce'],                         // 0: almost nothing playing
  ['bounce','bounceM','dance'],              // 1: a groove starting
  ['dance','danceM','bounce','bounceM'],     // 2: the room is moving
  ['dance','danceM','spin','spinM']          // 3: full, or a drop
];

// One-shot gestures: the VRChat-style emotes. These are played over the dance and blended back
// out, never on top of each other.
export const GESTURES={
  peace:'assets/vrma/peace.vrma',     // a two-finger salute
  shoot:'assets/vrma/shoot.vrma',     // a point-and-fire
  show:'assets/vrma/show.vrma',       // arms open, the big one
  talk:'assets/vrma/talk.vrma',       // talking to the room
  clap:'assets/vrma/clap.vrma',       // applauding the crowd, or conducting it
  jump:'assets/vrma/jump.vrma',       // off the floor
  relax:'assets/vrma/relax.vrma',     // hands down, easy
  look:'assets/vrma/look.vrma',       // scanning the room
  bye:'assets/vrma/bye.vrma',         // a wave goodbye
  wow:'assets/vrma/wow.vrma',         // a startle, for a drop landing
  think:'assets/vrma/think.vrma',     // chin in hand, for a build
  blush:'assets/vrma/blush.vrma',     // caught the eye of the room
  mad:'assets/vrma/mad.vrma',         // a glare, for the hardest sections
  blues:'assets/vrma/blues.vrma',     // a slump, for a break
  sleepy:'assets/vrma/sleepy.vrma'    // almost asleep, for an intro or an outro
};

// A humanoid rig in metres; the stage's room is built around this.
export const AVATAR_HEIGHT=1.72;

// ---- humanoid bones -------------------------------------------------------
// VRM 1.0 bone names. The rig three-vrm builds for an avatar is named after that avatar's own
// bones, so a clip's track names differ per character; these names are the part that does not.
const HUMAN_BONES=['hips','spine','chest','upperChest','neck','head','leftEye','rightEye','jaw'];
{
  const LIMBS=['UpperLeg','LowerLeg','Foot','Toes','Shoulder','UpperArm','LowerArm','Hand'];
  const FINGERS=['ThumbMetacarpal','ThumbProximal','ThumbDistal','IndexProximal','IndexIntermediate',
    'IndexDistal','MiddleProximal','MiddleIntermediate','MiddleDistal','RingProximal',
    'RingIntermediate','RingDistal','LittleProximal','LittleIntermediate','LittleDistal'];
  for(const side of ['left','right']){
    for(const l of LIMBS)HUMAN_BONES.push(side+l);
    for(const f of FINGERS)HUMAN_BONES.push(side+f);
  }
}

const mirrorBone=n=>n.startsWith('left')?'right'+n.slice(4):n.startsWith('right')?'left'+n.slice(5):n;

// ---- clip toolkit ---------------------------------------------------------
// Everything below works on the THREE.AnimationClip that createVRMAnimationClip already built for
// this avatar, so a derived clip targets the same bone nodes and needs no retargeting of its own.
const TRACK_CLASS={
  quaternion:THREE.QuaternionKeyframeTrack,vector:THREE.VectorKeyframeTrack,
  number:THREE.NumberKeyframeTrack,string:THREE.StringKeyframeTrack,
  bool:THREE.BooleanKeyframeTrack,boolean:THREE.BooleanKeyframeTrack
};
const trackClass=t=>TRACK_CLASS[t.ValueTypeName]||THREE.KeyframeTrack;
const strideOf=t=>t.values.length/Math.max(1,t.times.length);

function copyTrack(t){return new (trackClass(t))(t.name,t.times.slice(),t.values.slice())}

// The mirror image of a clip, through the sagittal plane (x -> -x). Sided bones swap names and
// every rotation is reflected: a quaternion (x,y,z,w) becomes (x,-y,-z,w), a position (x,y,z)
// becomes (-x,y,z). This is an exact mirror of real mocap, not a new animation.
function mirrorClip(clip,nodeOf){
  const tracks=clip.tracks.map(t=>{
    const dot=t.name.lastIndexOf('.');
    const prefix=dot>0?t.name.slice(0,dot):t.name;
    const prop=dot>0?t.name.slice(dot+1):'';
    const bone=nodeOf.bone.get(prefix);
    if(!bone)return copyTrack(t);                    // the look-at proxy and anything non-humanoid
    const node=nodeOf.node.get(mirrorBone(bone));
    if(!node)return copyTrack(t);
    const stride=strideOf(t),vals=new Float32Array(t.values);
    if(prop==='quaternion'&&stride===4){
      for(let i=0;i<t.times.length;i++){vals[i*4+1]*=-1;vals[i*4+2]*=-1}
    }else if(prop==='position'&&stride===3){
      for(let i=0;i<t.times.length;i++)vals[i*3]*=-1;
    }
    return new (trackClass(t))(node+'.'+prop,t.times.slice(),vals);
  });
  return new THREE.AnimationClip(clip.name+' mirror',clip.duration,tracks);
}

// Mocap is rarely recorded dead centre: the hips' position track carries the performer's offset from
// the origin, which moved every avatar the same distance off its spot (about 18 cm to the left).
// Shift the track so its average sits on the spot; the sway and the steps inside the move are kept.
function centreRoot(clip,nodeOf){
  const hips=nodeOf.node.get('hips');
  const t=hips&&clip.tracks.find(x=>x.name===hips+'.position');
  if(!t||strideOf(t)!==3||!t.times.length)return clip;
  const n=t.times.length,v=t.values;
  let sx=0,sz=0;
  for(let i=0;i<n;i++){sx+=v[i*3];sz+=v[i*3+2]}
  const mx=sx/n,mz=sz/n;
  for(let i=0;i<n;i++){v[i*3]-=mx;v[i*3+2]-=mz}
  return clip;
}

// three-vrm ships the avatar's materials as MToon (VRM1) or unlit (VRM0). Unlit ignores every
// light in the room, which in a club means a flat sticker, so unlit materials are rebuilt as
// standard ones that keep the texture and take the stage's colour.
function relight(root){
  const cache=new Map();
  root.traverse(o=>{
    if(!o.isMesh&&!o.isSkinnedMesh)return;
    o.frustumCulled=false;                       // a skinned mesh's bounds lie until it is posed
    const src=Array.isArray(o.material)?o.material:[o.material];
    const out=src.map(m=>{
      if(!m||!m.isMeshBasicMaterial)return m;     // MToon and friends already respond to light
      if(cache.has(m))return cache.get(m);
      const std=new THREE.MeshStandardMaterial({
        map:m.map||null,color:m.color?m.color.clone():new THREE.Color(0xffffff),
        transparent:m.transparent,opacity:m.opacity,alphaTest:m.alphaTest,
        side:m.side,depthWrite:m.depthWrite,
        roughness:.72,metalness:.02
      });
      if(std.map)std.map.colorSpace=THREE.SRGBColorSpace;
      cache.set(m,std);
      return std;
    });
    o.material=Array.isArray(o.material)?out:out[0];
  });
}

// A VRM carries a fixed set of expressions, but which ones depends on the exporter: VRM0 says
// `joy`, VRM1 says `happy`, and some models capitalise. Resolve once, by name, and drive whatever
// is actually there — a model missing an expression simply keeps a neutral face for it.
function expressionNames(vrm){
  const em=vrm.expressionManager;
  const have=(em&&em.expressions||[]).map(e=>e.expressionName);
  const find=(...want)=>{
    for(const w of want){
      const hit=have.find(n=>n===w)||have.find(n=>n.toLowerCase()===w.toLowerCase());
      if(hit)return hit;
    }
    return null;
  };
  return {
    manager:em,
    happy:find('happy','joy','fun'),
    surprised:find('surprised','Surprised'),
    relaxed:find('relaxed','fun'),
    sad:find('sad','sorrow'),
    angry:find('angry'),
    aa:find('aa'),ih:find('ih'),ou:find('ou'),ee:find('ee'),oh:find('oh'),
    blink:find('blink','blinkLeft'),
    count:have.length
  };
}

// Anime avatars are painted for daylight: white hair, pale skin. Under a stage key that is a
// bloom source, and the result is a glowing head with no face in it. Dimming the character's own
// albedo keeps the highlights under the bloom threshold without touching the room's lights.
function calmDown(root,k=.85){
  const seen=new Set();
  root.traverse(o=>{
    if(!o.isMesh&&!o.isSkinnedMesh)return;
    const list=Array.isArray(o.material)?o.material:[o.material];
    list.forEach(m=>{
      if(!m||seen.has(m)||!m.color)return;
      seen.add(m);
      m.color.multiplyScalar(k);
    });
  });
}


// Emotes are rare: only where the music drops away (the breakdown and the outro), one per
// section at most, and never while the set is driving. Everywhere else she dances.
const SEC_TAGS={
  'Drop A':['drop','peak'],'Drop B':['drop','peak'],'Peak A':['peak','drop'],'Peak B':['peak','drop'],
  Groove:['groove'],Break:['break'],Build:['build'],Intro:['intro'],Outro:['outro']
};
const SECTION_EMOTES={intro:0,break:1,build:0,groove:0,drop:0,peak:0,outro:1};
const SECTION_ODDS={break:.5,outro:.5};
// an emote is played a little quicker than the mocap and never held longer than this
const EMOTE_SPEED=1.3,EMOTE_MAX=2.2;

// What each gesture is for. `crowd` marks the ones that read as working the room, `talk` opens the
// mouth, and `w` is how often it should come up against the others in its section.
const EMOTES={
  clap:  {w:3,tags:['break','outro'],crowd:true},
  peace: {w:3,tags:['break'],crowd:true},
  talk:  {w:2,tags:['break'],crowd:true,talk:true},
  blush: {w:2,tags:['break']},
  look:  {w:1,tags:['break']},
  bye:   {w:3,tags:['outro'],crowd:true},
  show:  {w:2,tags:['outro'],crowd:true},
  relax: {w:1,tags:['outro']}
};

export async function createDancer({url='assets/vrm/dj.vrm',height=AVATAR_HEIGHT,onStatus}={}){
  const say=(s)=>onStatus&&onStatus(s);

  const loader=new GLTFLoader();
  loader.register(p=>new VRMLoaderPlugin(p));
  loader.register(p=>new VRMAnimationLoaderPlugin(p));

  const gltf=await loader.loadAsync(url);
  const vrm=gltf.userData.vrm;
  if(!vrm)throw new Error('no VRM in '+url);

  // house-keeping the loader cannot do on its own
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  if(VRMUtils.combineSkeletons)VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.rotateVRM0(vrm);                      // VRM0 models face backwards; this makes them agree
  relight(vrm.scene);
  calmDown(vrm.scene);
  // measure, then scale to a human height so the composition's numbers keep their meaning
  const box=new THREE.Box3().setFromObject(vrm.scene);
  const raw=Math.max(1e-6,box.max.y-box.min.y);
  const scale=height/raw;

  // the wrapper: the stage positions and tilts this, the clip animates everything inside it.
  const group=new THREE.Group();
  const inner=new THREE.Group();
  inner.scale.setScalar(scale);
  inner.position.y=-box.min.y*scale;             // feet on the wrapper's origin
  inner.add(vrm.scene);
  group.add(inner);

  const mixer=new THREE.AnimationMixer(vrm.scene);
  const cache=new Map();                          // clip id -> {clip,action,energy}
  const loading=new Map();
  const sources=new Map();                        // base motion id -> unmodified clip
  const sourceLoading=new Map();
  const failed=new Set();                         // a clip that would not load is not retried forever
  const clipReady=(n)=>cache.has(n);

  // ---- this avatar's bone names -------------------------------------------
  // A derived clip is built from a clip that already targets this avatar's normalized bones, so
  // mirroring has to swap that avatar's own node names. These two maps are the translation.
  const nodeOf={bone:new Map(),node:new Map()};
  if(vrm.humanoid&&vrm.humanoid.getNormalizedBoneNode){
    for(const b of HUMAN_BONES){
      const node=vrm.humanoid.getNormalizedBoneNode(b);
      if(!node||!node.name)continue;
      nodeOf.bone.set(node.name,b);
      nodeOf.node.set(b,node.name);
    }
  }
  // without this map the mirrored variants are just copies of their source, so say why if it is empty
  if(!nodeOf.bone.size)say('this avatar exposes no humanoid bones, so the mirrored dances are copies');

  // ---- the motion library -------------------------------------------------
  // Bases are the files in MOTIONS; each one also comes mirrored, as `<id>M`.
  const LIB={};
  for(const id in MOTIONS){
    const energy=MOTIONS[id].energy;
    LIB[id]={base:id,energy};
    LIB[id+'M']={base:id,energy,mirror:true};
  }

  function loadSource(id){
    if(sources.has(id))return Promise.resolve(sources.get(id));
    if(sourceLoading.has(id))return sourceLoading.get(id);
    const src=MOTIONS[id].src;
    const p=loader.loadAsync(src).then(g=>{
      const anim=(g.userData.vrmAnimations||[])[0];
      if(!anim)throw new Error('no VRM animation in '+src);
      const clip=centreRoot(createVRMAnimationClip(anim,vrm),nodeOf);
      sources.set(id,clip);
      return clip;
    }).catch(err=>{say(id+' did not load: '+err.message);return null});
    sourceLoading.set(id,p);
    return p;
  }

  // One entry point for both kinds: a library dance (built from a base) or a one-shot gesture.
  function ensure(name){
    if(cache.has(name))return Promise.resolve(cache.get(name));
    if(loading.has(name))return loading.get(name);
    const rec=LIB[name];
    let p;
    if(rec){
      p=loadSource(rec.base).then(base=>{
        if(!base)return null;
        let clip=base;
        if(rec.mirror)clip=mirrorClip(clip,nodeOf);
        const entry={clip,action:mixer.clipAction(clip),energy:rec.energy,dance:true};
        cache.set(name,entry);
        return entry;
      });
    }else if(GESTURES[name]){
      const src=GESTURES[name];
      p=loader.loadAsync(src).then(g=>{
        const anim=(g.userData.vrmAnimations||[])[0];
        if(!anim)throw new Error('no VRM animation in '+src);
        const clip=centreRoot(createVRMAnimationClip(anim,vrm),nodeOf);
        const entry={clip,action:mixer.clipAction(clip),dance:false};
        cache.set(name,entry);
        return entry;
      }).catch(err=>{failed.add(name);say(name+' did not load: '+err.message);return null});
    }else{
      return Promise.resolve(null);
    }
    loading.set(name,p);
    return p;
  }

  // ---- gaze ----------------------------------------------------------------
  const gaze=new THREE.Object3D();
  gaze.position.set(0,-.1,1.8);
  group.add(gaze);
  if(vrm.lookAt)vrm.lookAt.target=gaze;

  // ---- state ---------------------------------------------------------------
  const state={
    name:null,bucket:-1,want:0,timeScale:1,bpm:124,loopBars:8,startBar:0,manual:0,gesture:null,
    heatSlow:0,secKey:null,switchedAt:-99,turn:0,
    lastBar:-1,lastEngageBar:-99,emoteBudget:0,moveDue:true,
    recent:[],recentEmotes:[],engage:0,speak:0,
    play(name,fade=.6,bar){
      if(failed.has(name))return false;
      if(!clipReady(name)){
        ensure(name).then(entry=>{if(entry&&!state.gesture&&!state.name)state.play(name,fade,bar)});
        return false;
      }
      if(state.name===name)return true;
      if(state.gesture)return false;               // never cut across a one-shot
      const next=cache.get(name);
      const prev=state.name?cache.get(state.name):null;
      const action=next.action;
      action.reset();
      action.enabled=true;
      action.setLoop(THREE.LoopRepeat,Infinity);
      action.setEffectiveWeight(1);
      action.play();
      if(prev&&prev.action!==action)prev.action.crossFadeTo(action,fade,false);
      state.name=name;
      state.switchedAt=mixer.time;
      state.startBar=bar!=null?bar:state.lastBar;
      state.applyTempo();
      return true;
    },
    // Lock the loop to 1, 2, 4, 8 or 16 bars, whichever the clip is nearest at this tempo, so it
    // wraps on a phrase line and never needs stretching by more than about 40%. Started on a
    // downbeat, a loop of whole bars stays on the grid for as long as it plays.
    applyTempo(){
      const e=state.name&&cache.get(state.name);
      if(!e||!e.dance)return;
      const bar=4*60/state.bpm;
      let bars=1;
      for(const b of [2,4,8,16])if(Math.abs(Math.log(e.clip.duration/(b*bar)))<Math.abs(Math.log(e.clip.duration/(bars*bar))))bars=b;
      state.loopBars=bars;
      state.timeScale=e.clip.duration/(bars*bar);
      e.action.setEffectiveTimeScale(state.timeScale);
    },
    // where the loop should be on this downbeat; a tab that slept or a dropped frame is put back
    resync(bar){
      const e=state.name&&cache.get(state.name);
      if(!e||!e.dance||state.gesture||mixer.time-state.switchedAt<2)return;
      const len=4*60/state.bpm,n=((bar-state.startBar)%state.loopBars+state.loopBars)%state.loopBars;
      const want=n*len*state.timeScale,d=Math.abs(e.action.time-want);
      if(d>.15&&d<e.clip.duration-.15)e.action.time=want;
    },
    setTempo(bpm){if(bpm&&bpm!==state.bpm){state.bpm=bpm;state.applyTempo()}},
    ready:()=>!!state.name
  };

  // ---- gestures: one-shot, blended over the dance by weight -----------------
  // The dance keeps running underneath and is never rewound: the two are mixed by `w`, so the
  // dance comes back from the frame it was on rather than restarting.
  function gesture(name){
    if(state.gesture||state.manual>0)return false;
    if(mixer.time-state.switchedAt<.7)return false;   // a dance crossfade is still settling
    if(!clipReady(name)){ensure(name);return false}
    const a=cache.get(name).action;
    const base=state.name?cache.get(state.name):null;
    a.reset();
    a.setLoop(THREE.LoopOnce,1);
    a.clampWhenFinished=true;
    a.setEffectiveTimeScale(EMOTE_SPEED);
    a.setEffectiveWeight(0);
    a.play();
    state.gesture={name,action:a,base,w:0,t:0,done:false};
    state.lastEmote=name;
    return true;
  }
  mixer.addEventListener('finished',e=>{
    const g=state.gesture;
    if(!g||e.action!==g.action)return;
    g.done=true;                                      // blendGesture() takes it back out
  });
  // weight in over .22s, hold for at most EMOTE_MAX, then weight out over .4s while the dance
  // comes back underneath
  function blendGesture(dt){
    const g=state.gesture;
    if(!g)return;
    g.t+=dt;
    if(g.t>=EMOTE_MAX)g.done=true;
    g.w=g.done?Math.max(0,g.w-dt/.4):Math.min(1,g.w+dt/.22);
    g.action.setEffectiveWeight(g.w);
    if(g.base&&g.base.action)g.base.action.setEffectiveWeight(1-g.w);
    if(g.done&&g.w<=0){g.action.stop();state.gesture=null}
  }

  // ---- face ----------------------------------------------------------------
  const EX=expressionNames(vrm);
  const face={happy:0,surprised:0,relaxed:0,sad:0,angry:0,aa:0,oh:0,ih:0,ee:0,blink:0,nextBlink:1.2+Math.random()*2};
  const put=(key,w)=>{
    const n=EX[key];
    if(n&&EX.manager)EX.manager.setValue(n,Math.max(0,Math.min(1,w)));
  };
  const ease=(cur,target,dt,rate)=>cur+(target-cur)*Math.min(1,dt*rate);

  // prefetch what a set reaches for first: the quiet end, the groove, and the drop
  ensure('idle');ensure('bounce');ensure('dance');
  // and the emotes, which are small: one that is still loading when its moment comes is skipped
  for(const n in EMOTES)ensure(n);

  const head=vrm.humanoid&&vrm.humanoid.getNormalizedBoneNode?vrm.humanoid.getNormalizedBoneNode('head'):null;
  const headRaw=vrm.humanoid&&vrm.humanoid.getBoneNode?vrm.humanoid.getBoneNode('head'):null;
  const meta=vrm.meta||{};
  const _q=new THREE.Quaternion(),_e=new THREE.Euler(0,0,0,'YXZ'),_v=new THREE.Vector3();


  const dancer={
    group,vrm,mixer,state,head,face,expressions:EX,
    title:meta.title||meta.name||'avatar',
    licence:meta.licenseName||meta.licenseUrl||'see the .vrm',
    author:meta.author||meta.authors||'',
    play:(n,f)=>state.play(n,f),
    // a hand-picked dance or emote holds for a while, so you can watch one clip without the set
    // overruling it; `dancer.motion('dance',30)` then `dancer.motion(null)` to give control back
    motion(n,hold=25){
      state.manual=hold;
      if(!n)return state.name;
      if(GESTURES[n]){state.manual=0;gesture(n);return n}
      state.play(n);
      return state.name;
    },
    emote:n=>gesture(n),
    setTempo:b=>state.setTempo(b),
    // what the library actually holds, for the console and for tests
    dances:()=>Object.keys(LIB),
    // true while she is working the room, which the stage cuts to a wider shot on
    engaging:()=>state.engage>0,

    // the stage hands in the room's heat every frame; this only reads the room; the move itself
    // changes in onBar(), on a downbeat
    mood(heat,sec){
      // The heat is smoothed in update(), so one kick cannot move it. Each edge has a dead band:
      // the room has to clearly rise past an edge, or fall well back under it, to change pool.
      const s=state.heatSlow;
      let want=0;
      for(let i=0;i<3;i++)if(s>[.25,.5,.8][i]+(state.want>i?-.06:.06))want=i+1;
      state.want=want;
      // the very first move starts at once rather than waiting for a downbeat
      if(!state.name&&state.manual<=0)state.play(POOLS[want][0],.3,state.lastBar);
    },

    // Called once per bar, on the downbeat. Both decisions live here, so the dance changes on the
    // grid and an emote starts on it: a new section changes the move at once, otherwise it holds
    // for eight bars (or four, when the room has changed band) and changes on a four-bar line.
    onBar(bar,sec,heat){
      if(bar===state.lastBar)return;                    // one decision per bar, not one per frame
      state.lastBar=bar;
      if(bar<state.startBar)state.startBar=bar;          // a new song restarts the bar count
      const tags=(sec&&SEC_TAGS[sec.n])||['groove'];
      const key=tags[0];
      const si=sec&&sec.si!=null?sec.si:-1;
      const secChanged=si!==state.secKey;
      if(secChanged){
        state.secKey=si;
        state.emoteBudget=SECTION_EMOTES[key]!=null?SECTION_EMOTES[key]:0;
        state.moveDue=true;
      }
      if(state.manual>0)return;
      const held=bar-state.startBar,onLine=!sec||sec.i%4===0;
      if(held>=8&&onLine)state.moveDue=true;
      if(state.want!==state.bucket&&held>=4&&onLine)state.moveDue=true;
      if(state.moveDue&&!state.gesture&&state.name){
        const pool=POOLS[state.want];
        // rotate: avoid the moves used in the last few switches, and never repeat the current one
        const fresh=pool.filter(n=>n!==state.name&&state.recent.indexOf(n)<0);
        const options=fresh.length?fresh:pool.filter(n=>n!==state.name);
        const pick=options.length?options[(Math.random()*options.length)|0]:pool[0];
        // two beats of crossfade, so one move flows into the next instead of snapping
        if(state.play(pick,Math.min(1.1,Math.max(.5,2*60/state.bpm)),bar)){
          state.moveDue=false;
          state.bucket=state.want;
          state.recent.push(pick);
          if(state.recent.length>4)state.recent.shift();
          return;                                       // a move change and an emote never share a bar
        }
      }
      state.resync(bar);

      // ---- emotes: rare, and only where the music drops away ----
      const drop=tags.indexOf('drop')>=0||tags.indexOf('peak')>=0;
      // opening a drop is worth a look at the room, without stopping the dance
      if(drop&&sec&&sec.first&&bar-state.lastEngageBar>24&&Math.random()<.7){
        state.lastEngageBar=bar;
        state.engage=3.4+Math.random()*1.6;             // seconds the camera reads as engagement
      }
      if(state.gesture||state.emoteBudget<=0)return;
      if(!sec||sec.i<2||sec.i%2!==0)return;               // settle into the section first
      if(Math.random()>(SECTION_ODDS[key]||0))return;
      const name=pickEmote(tags,false);
      if(name&&gesture(name)){
        state.emoteBudget--;
        if(EMOTES[name]&&EMOTES[name].crowd){
          state.lastEngageBar=bar;
          state.engage=2.6;
        }
      }
    },

    // kept for the console and for the stage's cue pads; it obeys the same budget as onBar()
    cue(part,level,sec){return null},

    update(dt,env,t,ctx){
      if(state.manual>0)state.manual=Math.max(0,state.manual-dt);
      const sec=ctx&&ctx.sec,heat=ctx&&ctx.heat!=null?ctx.heat:.5;
      const bar=ctx&&ctx.bar!=null?ctx.bar:0;
      state.heatSlow+=(heat-state.heatSlow)*Math.min(1,dt*.5);
      state.engage=Math.max(0,state.engage-dt);
      this.onBar(bar,sec,heat);

      if(state.ready()||state.gesture)mixer.update(dt);
      blendGesture(dt);

      // an emote is played to the camera: she turns to it while the emote is in, and back to the
      // decks as it fades out
      let face2cam=0;
      if(state.gesture&&ctx&&ctx.cam&&group.parent){
        _v.copy(ctx.cam);
        group.parent.worldToLocal(_v);
        const yaw=Math.atan2(_v.x-group.position.x,_v.z-group.position.z);
        face2cam=Math.max(-1.2,Math.min(1.2,yaw))*state.gesture.w;
      }
      state.turn=ease(state.turn,face2cam,dt,7);
      group.rotation.y=state.turn;

      // ---- the face: parts choose expressions, the mouth only opens to speak ----
      const tags=(sec&&SEC_TAGS[sec.n])||['groove'];
      const big=sec&&sec.big?1:0;
      const breakSection=sec&&sec.n==='Break';
      const g=state.gesture,gm=g?EMOTES[g.name]:null;
      const peak=tags.indexOf('peak')>=0?1:0;
      state.speak=ease(state.speak,gm&&gm.talk?1:0,dt,6);
      face.happy=ease(face.happy,Math.max(env.clap*.9,big*.4),dt,7);
      face.surprised=ease(face.surprised,Math.max(env.lead*.9,big*.6),dt,9);
      face.relaxed=ease(face.relaxed,Math.min(1,.25+env.pad*.5),dt,3);
      face.sad=ease(face.sad,breakSection?.3:0,dt,3);
      face.angry=ease(face.angry,Math.max(g&&g.name==='mad'?.8:0,peak*.12),dt,4);

      // The mouth follows speech, not the kick. `jab` is a loose syllable rhythm, so a talking
      // emote reads as talking and everything else leaves her mouth shut.
      const speak=state.speak;
      const jab=speak*(.3+.7*Math.abs(Math.sin(t*7.3)*Math.sin(t*2.9)));
      face.aa=ease(face.aa,jab,dt,16);
      face.oh=ease(face.oh,jab*.34,dt,14);
      face.ih=ease(face.ih,jab*.2,dt,16);
      face.ee=ease(face.ee,jab*.16,dt,16);

      // blinks on their own clock, quicker in a hot room
      face.nextBlink-=dt;
      if(face.nextBlink<=0){face.blink=1;face.nextBlink=(heat>.6?1.9:3.4)+Math.random()*2.4}
      face.blink=Math.max(0,face.blink-dt*7);

      put('happy',face.happy);
      put('surprised',face.surprised);
      put('relaxed',face.relaxed);
      put('sad',face.sad);
      put('angry',face.angry);
      put('aa',face.aa);
      put('oh',face.oh);
      put('ih',face.ih);
      put('ee',face.ee);
      put('blink',face.blink);

      // ---- gaze: out to the room when she is working it, at the decks otherwise ----
      const engaging=state.engage>0;
      const gx=engaging?Math.sin(t*.5)*.6:env.hat>.3?0:.08;
      const gy=engaging?.12:big?.55:env.hat>.35?-.5:-.08;
      const gz=engaging?2.7:big?2.3:env.hat>.35?.7:1.8;
      gaze.position.x=ease(gaze.position.x,gx,dt,engaging?2:3);
      gaze.position.y=ease(gaze.position.y,gy,dt,3);
      gaze.position.z=ease(gaze.position.z,gz,dt,3);

      // springs, expressions and look-at all resolve here, after the mixer wrote the bones
      if(vrm.update)vrm.update(dt);

      // ---- additive body language ------------------------------------------
      // Only the head moves, and only on the hard parts: a nod on the kick and a slight roll with
      // the hats. Rotating the wrapper was tried and read as a glitch sliding her sideways.
      if(headRaw){
        _e.set(env.kick*.05*Math.min(1,heat+.3),Math.sin(t*.9)*.05*heat,Math.sin(t*1.7)*.03*heat,'YXZ');
        _q.setFromEuler(_e);
        headRaw.quaternion.multiply(_q);
      }
      const k=env.kick||0;
      inner.rotation.z=0;
      inner.rotation.x=0;
      inner.scale.y=scale*(1+k*.005);
    }
  };

  // weighted pick, filtered by the section's tags and by whether the section wants the room's eye
  function pickEmote(tags,crowdOnly){
    const build=(skipRecent)=>{
      let total=0;
      const pool=[];
      for(const name in EMOTES){
        const e=EMOTES[name];
        if(!GESTURES[name]||failed.has(name))continue;
        if(crowdOnly&&!e.crowd)continue;
        if(!crowdOnly&&e.tags.every(x=>tags.indexOf(x)<0))continue;
        if(skipRecent&&state.recentEmotes.indexOf(name)>=0)continue;
        const w=Math.max(.05,e.w);
        pool.push({name,w});
        total+=w;
      }
      return {pool,total};
    };
    // prefer something she has not done lately, but never come up empty
    let {pool,total}=build(true);
    if(!pool.length){const all=build(false);pool=all.pool;total=all.total}
    if(!pool.length)return null;
    let r=Math.random()*total;
    let picked=pool[0].name;
    for(const p of pool){r-=p.w;if(r<=0){picked=p.name;break}}
    state.recentEmotes.push(picked);
    if(state.recentEmotes.length>5)state.recentEmotes.shift();
    return picked;
  }

  say('avatar '+dancer.title+' ('+dancer.licence+') from '+url+' \u00b7 '+Object.keys(LIB).length+' dances');
  return dancer;
}
