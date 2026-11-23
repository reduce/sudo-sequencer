// ---------- stage view ----------
// A three.js club: the DJ behind two decks on a lit riser, six moving heads on a front truss,
// a wall of LEDs showing the sequencer itself, lasers off the back truss, a haze of fake-
// volumetric beams, and a sequencer drawn onto the LED wall.
//
// This is a monitor, not a second audio engine. The music engine calls window.__stage.onStep()
// from inside sched() with the audio-clock time the step will sound at; the frame loop compares
// that against __bl.clock() (ac.currentTime), so a flash lands on the transient rather than on
// the next animation frame. No musical decision here reads wall time.
import * as THREE from 'three';
import {createDancer,AVATARS} from './vrm.js';
import {createPost,beamMaterial,radialTexture,paletteEnvironment,makeCrowd} from './fx.js';

// Characters are CC0 .vrm files listed in AVATARS (js/vrm.js); moods map onto .vrma dances there.

// The room, in metres. Every other number in this file is derived from these.
const RISER_Y=.85;                       // the DJ stands this high above the floor
const DJ_Z=-3.05;
const DJ_H=1.72;                         // the character's height, head included
const BOOTH_Z=-2.45;const CAM={z:.35,y:2.0,ty:1.98};   // in front of the stage

// The camera director. This is coverage for a music video rather than one fixed vantage: a house
// shot, trucks, a tight booth, a low angle, an audience angle, and a drone rig that orbits, cranes
// and flies in. A shot is a framing (its `look` is the point it aims at) and, for the moving ones,
// a path. `bars` is how long it holds before the director moves on.
const SHOTS=[
  {id:'house',  kind:'fixed', pos:[0,2.00,.35],    look:[0,1.98,DJ_Z], fov:44, bars:4},
  {id:'truckL', kind:'fixed', pos:[-1.05,1.95,.55],look:[0,1.98,DJ_Z], fov:42, bars:4},
  {id:'truckR', kind:'fixed', pos:[1.05,1.95,.55], look:[0,1.98,DJ_Z], fov:42, bars:4},
  {id:'booth',  kind:'fixed', pos:[0,2.10,-.55],   look:[0,2.05,DJ_Z], fov:38, bars:4},
  {id:'low',    kind:'fixed', pos:[.5,1.35,.70],   look:[0,2.05,DJ_Z], fov:48, bars:4},
  {id:'over',   kind:'fixed', pos:[-.55,2.45,.55], look:[0,1.98,DJ_Z], fov:44, bars:4},
  // the front of the room, just inside the audience, looking back at the DJ
  {id:'crowd',  kind:'fixed', pos:[0,1.62,2.30],   look:[0,2.02,DJ_Z], fov:40, bars:4},
  // the drone rig: a slow orbit, a high establishing orbit, a crane and a fly-in
  {id:'droneOrbit',kind:'orbit',r:6.4, h:3.9, cz:.9, phase:.6, arc:.9, speed:.10, fov:50, bars:8},
  {id:'droneHigh', kind:'orbit',r:10.5,h:7.4, cz:2.2, phase:.0, arc:.7, speed:.055,fov:46, bars:8},
  {id:'crane',     kind:'crane',x:.2, y0:1.35,y1:5.1, z0:1.0, z1:-.2, fov:46, bars:8},
  {id:'flyIn',     kind:'dolly',x:0,  y0:3.6, y1:2.1, z0:9.5, z1:1.1, fov:44, bars:8},
  {id:'sweep',     kind:'sweep',x0:-2.8,x1:2.8,y:1.9,z:.4, fov:46, bars:4}
];
const SHOT_OF=id=>SHOTS.find(s=>s.id===id);

// Which coverage a part of the set gets. The drone does the establishing work, the tight shots
// belong to drops, and the audience angle only appears when she is working the room.
const SHOT_SETS={
  intro: ['droneHigh','house','crane','truckL'],
  groove:['house','truckL','droneOrbit','truckR','over','low'],
  drop:  ['booth','low','flyIn','sweep','crowd','truckR'],
  break: ['droneOrbit','over','truckL','house'],
  build: ['crane','low','droneOrbit','truckR'],
  outro: ['droneHigh','crane','house','truckL'],
  engage:['crowd','house','droneOrbit','truckL']
};

// Resolved once, so the director is not rebuilding arrays every frame.
const SHOT_SET={};
for(const k in SHOT_SETS)SHOT_SET[k]=SHOT_SETS[k].map(SHOT_OF).filter(Boolean);

// The pose a shot wants at this moment. Fixed shots sit still; drones swing across the front of
// the stage (a full orbit would put the rig through the truss), cranes rise, dollies push in and
// sweeps cross the frame. `prog` is 0..1 through the shot.
const _sp=new THREE.Vector3(),_sl=new THREE.Vector3();
function shotPose(shot,time,prog){
  const p=_sp,l=_sl;
  const k=Math.max(0,Math.min(1,prog)),e=k*k*(3-2*k);
  if(shot.look)l.set(shot.look[0],shot.look[1],shot.look[2]);
  else l.set(0,CAM.ty,DJ_Z);
  switch(shot.kind){
    case 'orbit':{
      // a drone drifting across the front of the stage, never behind it
      const a=shot.phase+Math.sin(time*shot.speed)*shot.arc;
      p.set(Math.sin(a)*shot.r,shot.h+Math.sin(time*.6)*.15,Math.cos(a)*shot.r+shot.cz);
      break;
    }
    case 'crane':
    case 'dolly':
      p.set(shot.x,shot.y0+(shot.y1-shot.y0)*e,shot.z0+(shot.z1-shot.z0)*e);
      break;
    case 'sweep':
      p.set(shot.x0+(shot.x1-shot.x0)*Math.sin(k*Math.PI),shot.y,shot.z);
      break;
    default:
      if(shot.pos)p.set(shot.pos[0],shot.pos[1],shot.pos[2]);
      else p.set(0,CAM.y,CAM.z);
  }
  return {p,l,fov:shot.fov};
}

// Which coverage a section gets.
function shotSet(sec,engaging){
  if(engaging)return SHOT_SET.engage;
  const n=sec&&sec.n;
  if(n==='Intro')return SHOT_SET.intro;
  if(n==='Break')return SHOT_SET.break;
  if(n==='Build')return SHOT_SET.build;
  if(n==='Outro')return SHOT_SET.outro;
  if(sec&&(sec.big||sec.drop))return SHOT_SET.drop;
  return SHOT_SET.groove;
}

const canvas=document.getElementById('stage');
const cap=document.getElementById('scap');
const stateEl=document.getElementById('sstate');
if(canvas){
  const rc=getComputedStyle(document.documentElement);
  const tok=(n,f)=>rc.getPropertyValue(n).trim()||f;
  const C={
    kick:tok('--kick','#ff5470'),clap:tok('--clap','#ffb03a'),hat:tok('--hat','#ffe45e'),
    ohat:tok('--ohat','#7bffb2'),perc:tok('--perc','#3ff0d0'),bass:tok('--bass','#3aa0ff'),
    chords:tok('--chords','#b78bff'),pad:tok('--pad','#ff8ad8'),arp:tok('--arp','#8ef0ff'),
    lead:tok('--lead','#ff4fd8')
  };
  const IDS=['kick','clap','hat','ohat','perc','bass','chords','pad','arp','lead'];
  const color=id=>new THREE.Color(C[id]||'#ffffff');
  const COLOR={};IDS.forEach(id=>{COLOR[id]=color(id)});

  let renderer=null;
  try{
    renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
  }catch(e){
    if(cap)cap.textContent='This browser could not start WebGL, so the stage is not available. The other views still work.';
  }

  if(renderer){
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=.98;

    const scene=new THREE.Scene();
    scene.background=new THREE.Color(0x04060b);
    scene.fog=new THREE.FogExp2(0x04060b,.02);
    // a cheap cube of the palette, so the metal floor and deck tops pick up the light colours
    scene.environment=paletteEnvironment(renderer,IDS.map(id=>C[id]));

    const camera=new THREE.PerspectiveCamera(46,1,.1,140);
    camera.position.set(0,CAM.y,CAM.z);
    camera.lookAt(0,CAM.ty,DJ_Z);
    const post=createPost(renderer,scene,camera);

    const std=(c,o)=>new THREE.MeshStandardMaterial(Object.assign({color:c,roughness:.62,metalness:.35},o));
    const glow=(c,op)=>new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:op,
      blending:THREE.AdditiveBlending,depthWrite:false});
    // a cone whose apex sits at the object's origin and whose body runs along +Z, so the parent
    // can simply lookAt() the point it is meant to hit
    const beamCone=(c,r,len,noise)=>{
      const m=new THREE.Mesh(new THREE.ConeGeometry(r,len,28,1,true),beamMaterial(c,{noise}));
      m.rotation.x=-Math.PI/2;               // +y (the apex end) becomes -z, then shift along z
      m.position.z=len/2;
      return m;
    };

    // ---- room ----
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(90,90),
      new THREE.MeshStandardMaterial({color:0x04060b,roughness:.3,metalness:.9,envMapIntensity:.3}));
    floor.rotation.x=-Math.PI/2;
    scene.add(floor);
    const grid=new THREE.GridHelper(90,90,0x4fb6d0,0x17414f);
    grid.material.opacity=.62;grid.material.transparent=true;
    grid.position.y=.004;
    scene.add(grid);
    // the room's back and side walls keep the haze from leaking into black nothing
    const wallMat=new THREE.MeshStandardMaterial({color:0x080b12,roughness:.95,metalness:.1});
    const backWall=new THREE.Mesh(new THREE.PlaneGeometry(40,14),wallMat);
    backWall.position.set(0,7,-11);
    scene.add(backWall);
    [-12,12].forEach(x=>{
      const side=new THREE.Mesh(new THREE.PlaneGeometry(30,14),wallMat);
      side.rotation.y=x<0?Math.PI/2:-Math.PI/2;
      side.position.set(x,7,-1);
      scene.add(side);
      // a vertical neon tube in each corner gives the room an edge
      const tube=new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,7,8),glow(0x35e0d0,.5));
      tube.position.set(x*.86,3.5,-8.6);
      scene.add(tube);
    });

    scene.add(new THREE.AmbientLight(0x2a3a55,.8));
    // one warm key on the character, so the face is always readable even between lights.
    // This used to sit at 140 and burn a pale avatar out to white; a stage key this close is
    // worth far less than that, and the rim does the separating work now.
    const key=new THREE.SpotLight(0xffe8d4,7,20,.7,.7,1.5);
    key.position.set(2.6,5.0,1.0);
    key.target.position.set(0,2.1,DJ_Z);
    scene.add(key,key.target);
    // a cool edge from behind the DJ: without it a dark outfit disappears into the dark wall
    const djEdge=new THREE.SpotLight(0x8fe6ff,6,10,.95,.95,1.6);
    djEdge.position.set(-1.1,3.4,-5.1);
    djEdge.target.position.set(0,2.0,DJ_Z);
    // a small warm fill in front of the face: enough to read expressions, too weak to clip
    const djFill=new THREE.PointLight(0xffd9b8,2.0,4.5,2);
    djFill.position.set(.25,2.15,BOOTH_Z+.9);
    scene.add(djEdge,djEdge.target,djFill);
    // a magenta rim from behind the booth separates the DJ from the LED wall
    const rim=new THREE.PointLight(COLOR.lead,5,14,2);
    rim.position.set(0,2.6,-5.6);
    const fill=new THREE.PointLight(COLOR.bass,12,18,2);
    fill.position.set(-5,2.4,1.6);
    scene.add(rim,fill);
    // a low uplight at the front lip washes the floor in front of the riser
    const frontFill=new THREE.PointLight(0x9fc4ff,10,7,2);
    frontFill.position.set(0,.35,-.9);

    // ---- LED wall: the sequencer itself, drawn to a canvas and used as the wall's face ----
    const led=document.createElement('canvas');
    led.width=640; led.height=336;
    const lctx=led.getContext('2d');
    const ledTex=new THREE.CanvasTexture(led);
    ledTex.colorSpace=THREE.SRGBColorSpace;
    ledTex.minFilter=THREE.LinearFilter;
    const WALL={w:11,h:5.8,y:3.5,z:-9};
    const wallGlow=new THREE.Mesh(new THREE.PlaneGeometry(WALL.w*1.5,WALL.h*1.7),
      new THREE.MeshBasicMaterial({map:radialTexture(256),color:0x8fa8ff,transparent:true,
        opacity:.18,blending:THREE.AdditiveBlending,depthWrite:false}));
    wallGlow.position.set(0,WALL.y,WALL.z-.05);
    scene.add(wallGlow);
    const wall=new THREE.Mesh(new THREE.PlaneGeometry(WALL.w,WALL.h),
      new THREE.MeshBasicMaterial({map:ledTex,toneMapped:false}));
    wall.position.set(0,WALL.y,WALL.z);
    scene.add(wall);
    // the wall's frame, so it reads as a built thing rather than a floating image
    const frameMat=std(0x0b1018,{roughness:.5,metalness:.6});
    const wallFrame=new THREE.Mesh(new THREE.BoxGeometry(WALL.w+.34,WALL.h+.34,.24),frameMat);
    wallFrame.position.set(0,WALL.y,WALL.z-.14);
    scene.add(wallFrame);

    // One question, one answer: does this part sound on this step, and how hard?
    // The drum parts publish a velocity per step in L.v. The five pitch parts do not — a bass, arp
    // or lead note is a degree (>= 0 sounds, -1 rests), and chords and pad are hit flags. Reading
    // L.v alone for all ten parts is why the bass, chords, pad, arp and lead envelopes used to sit
    // at zero for a whole set, and with them the strip, the rim, the wash and half the meters.
    function stepOn(id,v,L,s){
      const direct=v&&v[id]&&v[id][s];
      if(direct)return Math.min(1,direct);
      if(!L)return 0;
      switch(id){
        case 'bass':  return L.bass&&L.bass[s]>=0?.85:0;
        case 'lead':  return L.lead&&L.lead[s]>=0?1:0;
        case 'arp':   return L.arp&&L.arp[s]>=0?.8:0;
        case 'chords':return L.chordHit&&L.chordHit[s]?1:0;
        case 'pad':   return L.pad&&L.pad[s]?.7:0;
        default:      return 0;
      }
    }

    function drawWall(bno,v,L,step,sec){
      const W=led.width,H=led.height;
      const g=lctx.createLinearGradient(0,0,0,H);
      g.addColorStop(0,'#0a1030');g.addColorStop(.55,'#100a24');g.addColorStop(1,'#05060f');
      lctx.fillStyle=g;lctx.fillRect(0,0,W,H);

      // the panel grid, drawn under everything: 20 x 12 physical panels
      lctx.strokeStyle='rgba(120,150,220,.10)';lctx.lineWidth=2;
      for(let c=1;c<20;c++){lctx.beginPath();lctx.moveTo(c*W/20,0);lctx.lineTo(c*W/20,H);lctx.stroke()}
      for(let r=1;r<12;r++){lctx.beginPath();lctx.moveTo(0,r*H/12);lctx.lineTo(W,r*H/12);lctx.stroke()}

      // 16 step columns x 10 part rows: the wall shows the pattern that is playing
      const x0=W*.06,tones=W*.88,cols=16,rows=10,cw=tones/cols,rh=(H*.62)/rows,top=H*.30;
      for(let r=0;r<rows;r++){
        const id=IDS[r];
        for(let c=0;c<cols;c++){
          const on=stepOn(id,v,L,c);
          const near=c===step;
          lctx.globalAlpha=on?(near?1:.62):.035;
          lctx.fillStyle=on?C[id]:'#232a44';
          lctx.fillRect(x0+c*cw+2,top+r*rh+2,cw-4,rh-5);
        }
      }
      // the playhead column, over the top of the cells
      if(step>=0){
        lctx.globalAlpha=.09;
        lctx.fillStyle='#ffffff';
        lctx.fillRect(x0+step*cw,top-4,cw,rh*rows+8);
        // a bright tick at the head of the column, so the playhead still reads
        lctx.globalAlpha=.85;
        lctx.fillStyle='#ffffff';
        lctx.fillRect(x0+step*cw,top-7,cw,4);
      }
      // header strip: the bar counter and the section name
      lctx.globalAlpha=.9;
      lctx.fillStyle='#9fe8ff';
      lctx.font='700 22px "JetBrains Mono",monospace';
      lctx.textBaseline='top';
      lctx.fillText('BAR '+String((bno|0)+1).padStart(2,'0'),x0,10);
      lctx.fillStyle='#ff5e9a';
      lctx.textAlign='right';
      lctx.fillText((sec&&sec.n?sec.n:'LIVE').toUpperCase(),W-x0,10);
      lctx.textAlign='left';
      // level bars along the bottom edge, one per part
      const bh=H*.13,by=H-bh-H*.02;
      for(let i=0;i<IDS.length;i++){
        const lvl=Math.min(1,env[IDS[i]]*1.2);
        lctx.globalAlpha=.25;lctx.fillStyle=C[IDS[i]];
        lctx.fillRect(x0+i*(tones/IDS.length),by,tones/IDS.length-5,bh);
        lctx.globalAlpha=.95;
        lctx.fillRect(x0+i*(tones/IDS.length),by+bh*(1-lvl),tones/IDS.length-5,bh*lvl);
      }
      if(sec&&sec.drop){
        lctx.globalAlpha=.18;
        lctx.fillStyle=sec.big?'#ff5e9a':'#4ac8ff';
        lctx.fillRect(0,0,W,H);
      }
      lctx.globalAlpha=1;
      ledTex.needsUpdate=true;
    }

    // ---- stage: riser, booth, decks ----
    const riser=new THREE.Mesh(new THREE.BoxGeometry(7,RISER_Y,3.6),std(0x090d14,{roughness:.78,metalness:.15}));
    riser.position.set(0,RISER_Y/2,-3.3);
    scene.add(riser);
    // the booth face is the widest lit surface in frame, so it carries a row of level bars: one
    // per part, growing from the deck line, which turns a dead slab into the loudest part of the stage
    const vu=[];
    const vuGeo=new THREE.PlaneGeometry(.19,.4);
    vuGeo.translate(0,.275,0);                           // origin at the bar's foot, so it grows up
    for(let i=0;i<14;i++){
      const part=IDS[(i*3+1)%IDS.length];
      const m=glow(COLOR[part],.5);
      const bar=new THREE.Mesh(vuGeo,m);
      bar.position.set((i-6.5)*.245,RISER_Y+.03,BOOTH_Z+.312);
      scene.add(bar);
      vu.push({m,bar,part});
    }
    // the lit front edge of the riser, driven by the bass
    const stripMat=new THREE.MeshBasicMaterial({color:COLOR.bass,transparent:true,opacity:.25,
      blending:THREE.AdditiveBlending,depthWrite:false});
    const strip=new THREE.Mesh(new THREE.PlaneGeometry(7,.05),stripMat);
    strip.position.set(0,RISER_Y-.05,-1.51);
    scene.add(strip);
    const riserLip=new THREE.Mesh(new THREE.PlaneGeometry(7,.05),glow(COLOR.perc,.09));
    riserLip.position.set(0,.02,-1.49);
    riserLip.rotation.x=-Math.PI/2;
    scene.add(riserLip);

    const booth=new THREE.Group();
    scene.add(booth);
    const body=new THREE.Mesh(new THREE.BoxGeometry(3.5,.55,.62),std(0x0b1019,{roughness:.6,metalness:.35}));
    body.position.set(0,RISER_Y+.275,BOOTH_Z);
    const top=new THREE.Mesh(new THREE.BoxGeometry(3.72,.1,.8),std(0x141b27,{roughness:.42,metalness:.8,envMapIntensity:.45}));
    top.position.set(0,RISER_Y+.55,BOOTH_Z);
    booth.add(body,top);
    const DECK_Y=RISER_Y+.62;
    // a thin light line across the booth face, which is the sort of thing stages actually have
    const faceLine=new THREE.Mesh(new THREE.PlaneGeometry(3.4,.012),glow(COLOR.arp,.32));
    faceLine.position.set(0,RISER_Y+.44,BOOTH_Z+.32);
    booth.add(faceLine);

    const platters=[];
    [-.95,.95].forEach(x=>{
      const dish=new THREE.Mesh(new THREE.CylinderGeometry(.33,.33,.04,40),
        std(0x1b2434,{roughness:.35,metalness:.85,envMapIntensity:.55}));
      dish.position.set(x,DECK_Y+.02,BOOTH_Z);
      const label=new THREE.Mesh(new THREE.CylinderGeometry(.1,.1,.045,24),
        new THREE.MeshStandardMaterial({color:0xc9c4e8,emissive:COLOR.chords,emissiveIntensity:.18,roughness:.4}));
      label.position.copy(dish.position);
      const arm=new THREE.Mesh(new THREE.BoxGeometry(.03,.03,.42),std(0x9aa6bb,{metalness:.95,roughness:.25}));
      arm.position.set(x+.27,DECK_Y+.07,BOOTH_Z);
      arm.rotation.y=-.24;
      booth.add(dish,label,arm);
      platters.push(dish,label);
    });
    const mixerTop=new THREE.Mesh(new THREE.BoxGeometry(.86,.05,.6),std(0x111823,{roughness:.4,metalness:.7}));
    mixerTop.position.set(0,DECK_Y+.03,BOOTH_Z);
    booth.add(mixerTop);
    // eight small emissive knobs jump with the chord and lead parts
    const knobs=[];
    const knobGeo=new THREE.CylinderGeometry(.018,.018,.02,10);
    for(let i=0;i<8;i++){
      const k=new THREE.Mesh(knobGeo,new THREE.MeshStandardMaterial({color:0x0c1119,
        emissive:COLOR[i%2?'chords':'arp'],emissiveIntensity:.22,roughness:.4}));
      k.position.set((i%4-1.5)*.16,DECK_Y+.06,BOOTH_Z+(i<4?-.14:.14));
      booth.add(k);
      knobs.push(k);
    }

    // ---- the DJ: a VRM avatar dancing a VRMA mocap clip ----
    // The wrapper sits on the riser and carries the additive body language; everything inside it
    // is the avatar's own rig, posed by the clip. No code here knows which character is loaded.
    const dj=new THREE.Group();
    dj.position.set(0,RISER_Y,DJ_Z);
    scene.add(dj);

    // a silhouette in the booth's colours, so a missing or broken .vrm still leaves a DJ on stage
    const stand=new THREE.Group();
    [[.17,.2,.62,0x0e141f],[.19,.34,1.14,0x1c2436],[.15,.2,1.34,0x1c2436]].forEach(([r,h,y,c],i)=>{
      const m=new THREE.Mesh(new THREE.CapsuleGeometry(r,h,4,12),std(c,{roughness:.85,metalness:.05}));
      m.position.y=y;
      if(i===2)m.rotation.z=Math.PI/2;
      stand.add(m);
    });
    const standHead=new THREE.Mesh(new THREE.SphereGeometry(.105,14,12),std(0xd79a63,{roughness:.6}));
    standHead.position.y=1.6;
    stand.add(standHead);
    dj.add(stand);

    let dancer=null,dancerUrl=null,dancerWanted=false;
    const charNote=document.getElementById('headnote');

    // Changing character is building a new dancer and swapping the group: the rig, its mixer and
    // the clip cache all belong to one avatar, so nothing is shared between them.
    const loadDancer=(url)=>{
      const wanted=url||picked();
      if(wanted===dancerUrl)return;
      dancerUrl=wanted;
      dancerWanted=true;
      createDancer({
        url:wanted,
        height:DJ_H,
        onStatus:s=>{if(charNote)charNote.textContent=s}
      }).then(d=>{
        if(dancerUrl!==wanted){d.mixer.stopAllAction();return}   // a newer pick won the race
        if(dancer){dj.remove(dancer.group);dancer.mixer.stopAllAction()}
        dancer=d;
        dj.remove(stand);
        dj.add(d.group);
        // the stage name from AVATARS, then the model's own title and author, as credit
        const named=AVATARS.find(a=>a.url===wanted);
        if(charNote)charNote.textContent='DJ: '+(named?named.label+' · model ':'')+d.title+(d.author?' by '+d.author:'')+' \u00b7 '+d.licence+' \u00b7 dances from assets/vrma';
        markChar();
      }).catch(err=>{
        // an avatar file is missing: fall through to the next one in AVATARS
        const i=AVATARS.findIndex(a=>a.url===wanted);
        if(!url&&i>=0&&i<AVATARS.length-1&&dancerUrl===wanted){
          missing.add(wanted);
          dancerUrl=null;
          loadDancer();
          if(charNote)charNote.textContent=AVATARS[i].label+' is not in '+wanted+', so '+AVATARS[i+1].label+' is on the decks.';
          return;
        }
        if(charNote)charNote.textContent='DJ: the avatar did not load ('+(err&&err.message||err)+'), so a stand-in is on stage. Check '+wanted+'.';
      });
    };

    // the picker in the SYS panel: one key per avatar in the manifest
    // an avatar file that failed to load is skipped from then on, so a missing primary DJ is
    // tried once per page, not on every view change
    const missing=new Set();
    const picked=()=>{
      const q=new URLSearchParams(location.search).get('vrm');
      const hit=AVATARS.find(a=>a.id===q||a.url===q);
      return (hit||AVATARS.find(a=>!missing.has(a.url))||AVATARS[AVATARS.length-1]).url;
    };
    const charKeys=new Map();
    const markChar=()=>charKeys.forEach((b,u)=>b.setAttribute('aria-pressed',String(u===dancerUrl)));
    const charBox=document.getElementById('hChars');
    if(charBox){
      AVATARS.forEach(a=>{
        const b=document.createElement('button');
        b.type='button';
        b.className='key ghost';
        b.textContent=a.label.toUpperCase();
        b.setAttribute('aria-pressed','false');
        b.addEventListener('click',()=>loadDancer(a.url));
        charBox.appendChild(b);
        charKeys.set(a.url,b);
      });
    }

    // ---- front truss with six moving heads ----
    const TRUSS_Y=3.95;
    const truss=new THREE.Mesh(new THREE.BoxGeometry(12,.18,.18),std(0x161e2b,{metalness:.85,roughness:.35}));
    truss.position.set(0,TRUSS_Y,-1.6);
    scene.add(truss);
    const trussBack=new THREE.Mesh(new THREE.BoxGeometry(12,.14,.14),std(0x121a26,{metalness:.85,roughness:.35}));
    trussBack.position.set(0,TRUSS_Y+.55,-6.4);
    scene.add(trussBack);
    [-5.9,5.9].forEach(x=>{
      const leg=new THREE.Mesh(new THREE.BoxGeometry(.18,TRUSS_Y,.18),std(0x111823,{metalness:.8,roughness:.4}));
      leg.position.set(x,TRUSS_Y/2,-1.6);
      scene.add(leg);
      const back=new THREE.Mesh(new THREE.BoxGeometry(.14,TRUSS_Y+.55,.14),std(0x0e141e,{metalness:.8}));
      back.position.set(x,(TRUSS_Y+.55)/2,-6.4);
      scene.add(back);
    });

    const HEADS=[
      {x:-4.3,part:'clap'},{x:-2.6,part:'hat'},{x:-.88,part:'perc'},
      {x:.88,part:'arp'},{x:2.6,part:'lead'},{x:4.3,part:'chords'}
    ];
    const heads=HEADS.map((H,i)=>{
      const g=new THREE.Group();
      g.position.set(H.x,TRUSS_Y-.22,-1.6);
      // the yoke hangs off the truss, the barrel tilts inside it
      const clamp=new THREE.Mesh(new THREE.BoxGeometry(.1,.16,.1),std(0x0d131c,{metalness:.9,roughness:.4}));
      clamp.position.y=.14;
      const yoke=new THREE.Mesh(new THREE.TorusGeometry(.17,.022,6,16,Math.PI),std(0x141b26,{metalness:.9,roughness:.35}));
      yoke.rotation.y=Math.PI/2;
      const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.12,.16,.34,16),std(0x0f151f,{metalness:.85,roughness:.3}));
      barrel.rotation.x=Math.PI/2;
      barrel.position.z=.04;
      const lensMat=new THREE.MeshStandardMaterial({color:0x05070d,emissive:color(H.part),emissiveIntensity:2.2});
      const lens=new THREE.Mesh(new THREE.CircleGeometry(.105,18),lensMat);
      lens.position.z=.215;
      const flare=new THREE.Sprite(new THREE.SpriteMaterial({map:radialTexture(),color:color(H.part),
        blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,opacity:.55}));
      flare.scale.setScalar(.7);flare.position.z=.26;

      // the beam itself: a hot core inside a wide haze cone, both aimed with lookAt()
      const aim=new THREE.Group();
      aim.position.copy(g.position);
      const haze=beamCone(C[H.part],.82,13,.7);
      const core=beamCone(C[H.part],.17,12.4,.25);
      aim.add(haze,core);
      scene.add(aim);

      g.add(clamp,yoke,barrel,lens,flare);
      scene.add(g);
      return {g,aim,haze,core,lensMat,flare,part:H.part,base:color(H.part),
        phase:i*Math.PI*2/HEADS.length,swing:0,tx:0,ty:0,tz:0};
    });

    // ---- the light show's vocabulary ----
    // A pattern is a function of (head, its place across the truss, time, whether this head is the
    // one the chase has reached) returning the point the beam lands on. Patterns change on bar
    // lines, so a move in the lights is always a musical move.
    const LIGHT_PATTERNS={
      fan:  (s,t,step,hit)=>[s*4.6,.16,-1.15+Math.sin(t*.6)*.55],
      chase:(s,t,step,hit)=>[s*3.4,.30+(hit?1.1:0),-1.25+(hit?-.5:.9)],
      cross:(s,t,step,hit)=>[-s*2.5,.20,-1.3+Math.cos(t*.9)*.5],
      sweep:(s,t,step,hit)=>[Math.sin(t*.55)*4.6*(1-.45*Math.abs(s)),.30,-1.25],
      pods: (s,t,step,hit)=>[(s<0?-1:1)*(1.3+Math.abs(s)*1.6),.20,-1.4+Math.sin(t*1.1)*.5],
      up:   (s,t,step,hit)=>[s*2.4,3.4+Math.sin(t*.8)*1.2,-6.1]
    };
    let lightPat='fan',lightPatBar=-1;
    // one pattern per two bars, chosen for the part of the set: a chase through the drops, beams
    // into the haze on a build, a slow sweep through the breakdown
    function choosePattern(barNo,sec,engaging){
      if(barNo===lightPatBar)return;
      lightPatBar=barNo;
      const n=sec&&sec.n;
      let pool=['fan','sweep','pods','chase','cross','up'];
      if(engaging)pool=['cross','fan','sweep'];
      else if(n==='Break')pool=['sweep','pods','fan'];
      else if(n==='Build')pool=['up','cross','chase'];
      else if(n==='Intro')pool=['fan','sweep','pods'];
      else if(n==='Outro')pool=['up','fan','sweep'];
      else if(sec&&(sec.big||sec.drop))pool=['chase','cross','up','fan'];
      lightPat=pool[Math.floor(barNo/2)%pool.length];
    }

    const lasers=[];
    for(let i=0;i<6;i++){
      const c=i%3===0?C.ohat:i%3===1?C.arp:C.lead;
      const mat=glow(c,0);
      const beam=new THREE.Mesh(new THREE.CylinderGeometry(.016,.004,14,6,1,true),mat);
      beam.rotation.x=Math.PI/2;             // the axis runs along +z
      beam.position.z=7;
      const aim=new THREE.Group();
      aim.position.set((i-2.5)*.42,TRUSS_Y+.55,-6.4);
      aim.add(beam);
      scene.add(aim);
      const dot=new THREE.Sprite(new THREE.SpriteMaterial({map:radialTexture(),color:c,
        blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,opacity:.5}));
      dot.scale.setScalar(.5);
      aim.add(dot);
      lasers.push({aim,mat,dot,dir:i%2?1:-1,phase:i/6*Math.PI*2,base:c});
    }

    // ---- rings on the floor in front of the stage, one per kick ----
    const rings=[];
    for(let i=0;i<5;i++){
      const m=glow(COLOR.kick,0);
      const ring=new THREE.Mesh(new THREE.RingGeometry(.5,.62,64),m);
      ring.rotation.x=-Math.PI/2;
      ring.position.set(0,.01,-1.35);
      scene.add(ring);
      rings.push({ring,m,life:0});
    }

    // ---- the audience ----
    // Dark silhouettes filling the floor in front of the riser, with a few phone lights. They are
    // what makes an audience shot read as one, and they give the drone orbits something to fly
    // over. Kept low and unlit enough that they never compete with the DJ.
    const crowd=makeCrowd(150,[
      {z0:-1.2,z1:1.4,x0:1.3,x1:5.6},
      {z0:1.4,z1:4.8,x0:.9,x1:7.2}
    ]);
    scene.add(crowd.group);

    // ---- strobe ----
    const strobe=new THREE.PointLight(0xffffff,0,22,2);
    strobe.position.set(0,3.6,-.4);
    scene.add(strobe);

    // No confetti: the sparks that used to burst off the deck read as floating dots over the
    // whole frame, which fights the lights. The booth flashes and the beams carry a hit instead.

    // ---- state ----
    const env={kick:0,clap:0,hat:0,ohat:0,perc:0,bass:0,chords:0,pad:0,arp:0,lead:0};
    const queue=[];
    let step=0,bar=null,sec=null,energy=.55,active=false,last=performance.now();
    let lastWallStep=-1,spin=0,flash=0,dropEnv=0,bpm=124,faceCam=false,boost=0,boostTarget=0;
    let liveBar=null;                                  // the pattern playing, for the LED wall

    // ---- camera director state ----
    // The director holds one shot at a time, and either cuts to the next (section changes, drops)
    // or eases into it (drone moves, which would look wrong snapped).
    let camShot=SHOTS[0],camT=0,camCut=true,camSec=null,shotIdx=0;
    const camPos=new THREE.Vector3(),camLook=new THREE.Vector3(0,CAM.ty,DJ_Z);
    let camFov=camShot.fov;

    const _v3=new THREE.Vector3(),_p3=new THREE.Vector3(),_l3=new THREE.Vector3();
    const wash=new THREE.Color('#b78bff'),baseFog=new THREE.Color(0x04060b);
    const camTarget=new THREE.Vector3(0,CAM.ty,DJ_Z);

    // The club view calls this once per sixteenth note, with the audio time the step plays at.
    window.__stage={
      onStep(e){
        if(!e)return;
        if(queue.length>600)queue.splice(0,300);
        queue.push(e);
      },
      setActive(v){active=!!v;if(active){last=performance.now();resize();loadDancer()}},
      state:()=>({step,bar,section:sec&&sec.n,energy}),
      // live part levels, for the HUD meters
      levels:()=>Object.assign({},env),
      // the game layer pushes hype in here: it opens the haze, the bloom and the exposure
      setBoost:b=>{boostTarget=Math.max(0,Math.min(1.2,+b||0))},
      // a cue pad fires: flash that part's colour
      pulse(id){
        if(!C[id])return;
        env[id]=1;flash=Math.max(flash,.45);
      },
      // kept so a caller from the game layer still has something to hold on to
      sparkle:()=>null,
      // handles for tuning from the console
      debug:{renderer,scene,camera,post,env,heads,get dancer(){return dancer},get boost(){return boost}},
      // the character: which avatar and dance are on stage, and a way to force a motion
      avatar:()=>dancer,
      motion:n=>{if(!dancer)return null;dancer.motion(n);return dancer.state.name},
      // a close-up on the face, for checking the rig while tuning
      focusFace(v){faceCam=!!v;if(v){active=true;loadDancer()}}
    };

    function consume(){
      const bl=window.__bl;
      if(!bl||!bl.clock)return;
      const now=bl.clock();
      while(queue.length&&queue[0].t<=now){
        const e=queue.shift();
        if(e.t<now-1.5)continue;                       // stale after a pause or a seek: drop it
        step=e.s;bar=e.bar;liveBar=e.L||liveBar;sec=e.sec||sec;
        energy=e.sec?(e.sec.big?1:e.sec.n==='Break'?.34:e.sec.n==='Intro'?.42:.62):energy;
        bpm=e.bpm||bpm;
        const v=e.v||{},L=e.L||null;
        for(const id of IDS)env[id]=Math.max(env[id],stepOn(id,v,L,e.s));
        if(v.kick&&v.kick[e.s])spawnRing();
        if(v.clap&&v.clap[e.s])flash=Math.max(flash,.7);
        if(v.chords&&v.chords[e.s])knobs.forEach((k,i)=>{k.material.emissiveIntensity=.7+i*.22});
        if(e.s!==lastWallStep){lastWallStep=e.s;drawWall(bar,liveBar&&liveBar.v,liveBar,step,sec)}
      }
    }

    function spawnRing(){
      const r=rings.find(x=>x.life<=0)||rings[0];
      r.life=1;
    }

    // ---- resize ----
    function resize(){
      const w=canvas.clientWidth||640,h=canvas.clientHeight||440;
      renderer.setSize(w,h,false);
      camera.aspect=Math.max(1,w)/Math.max(1,h);
      camera.updateProjectionMatrix();
      post.setSize(w,h);
    }
    if(window.ResizeObserver)new ResizeObserver(resize).observe(canvas);
    window.addEventListener('resize',resize);
    resize();
    drawWall(0,null,null,0,null);

    // ---- frame ----
    function frame(){
      requestAnimationFrame(frame);
      if(!active||document.hidden)return;
      const now=performance.now();
      const dt=Math.min(.05,(now-last)/1000);
      last=now;
      consume();
      // the wash colour is whatever the music is made of right now
      wash.copy(COLOR.chords).lerp(COLOR.kick,Math.min(1,env.kick*.55)).lerp(COLOR.pad,Math.min(1,env.pad*1.6)).lerp(COLOR.lead,Math.min(1,env.lead));
      boostTarget=Math.min(1.2,energy*.30+env.kick*.25+flash*.22);
      boost+=(boostTarget-boost)*Math.min(1,dt*3);
      scene.fog.color.copy(baseFog).lerp(wash,.05+boost*.10);
      post.setBoost(boost);
      renderer.toneMappingExposure=.9+boost*.3;

      const decay=(rate)=>Math.pow(rate,dt*60);
      for(const id of IDS)env[id]*=decay(.88);
      flash*=decay(.55);
      dropEnv+=((sec&&sec.drop?1:0)-dropEnv)*Math.min(1,dt*2.2);

      const t=now/1000;
      const beat=t*bpm/60;
      const engaging=dancer&&dancer.engaging?dancer.engaging():false;

      // the character: tempo-locked mocap, mood chosen from the room's heat, additive weight
      if(dancer){
        dancer.setTempo(bpm);
        // heat follows what is actually sounding, not only the plan's section label: a run that
        // never gets a section still has to escalate as the parts pile in
        // A playing set always has a floor under the heat. One frame of envelopes is 0 more often
        // than not, so counting sounding parts alone left her posing through a track that was
        // going hard; the arrangement's own energy is the honest read of how hard the set is.
        let partsOn=0;
        for(const id of IDS)if(env[id]>.12)partsOn++;
        const heat=Math.min(1,Math.max(active?.42:0,energy*.72+partsOn*.05+env.kick*.18+flash*.12));
        dancer.mood(heat,sec);
        // the dance, the emotes and the mouth are decided inside the dancer, on the bar grid
        dancer.update(dt,env,t,{sec,heat,bar:bar|0,step,cam:camera.position});
      }

      // platters: a turntable's 33⅓ rpm, plus a shove on the kick
      spin+=dt*(3.49+env.kick*9);
      platters.forEach((p,i)=>{p.rotation.y=spin*(i%2?-1:1)});

      // ---- the light show ----
      // A pattern decides where each beam lands; patterns change on bar lines, so a move in the
      // lights is always a musical move, and the chase runs off the step the audio scheduler
      // published rather than off wall time.
      const barNo=bar|0;
      choosePattern(barNo,sec,engaging);
      const pat=LIGHT_PATTERNS[lightPat]||LIGHT_PATTERNS.fan;
      heads.forEach((h,i)=>{
        const s=(i-2.5)/2.5;                       // where it hangs across the truss, -1..1
        const onStep=step%12;
        const hit=lightPat==='chase'&&(onStep===i*2||onStep===i*2+1);
        const drive=Math.min(1,env[h.part]*.75+env.kick*.35+energy*.14+(hit?.45:0));
        h.swing+=((drive*.9+energy*.45)-h.swing)*Math.min(1,dt*5);
        const tgt=pat(s,t,.0,hit,i);
        h.tx=tgt[0];h.ty=tgt[1];h.tz=tgt[2];
        h.aim.lookAt(h.tx,h.ty,h.tz+2.4);
        const strength=.03+drive*.42+energy*.05+boost*.10+flash*.12;
        h.haze.material.uniforms.uColor.value.copy(h.base).lerp(wash,.22+boost*.22);
        h.haze.material.uniforms.uStrength.value=strength;
        h.haze.material.uniforms.uTime.value=t;
        h.core.material.uniforms.uColor.value.copy(h.haze.material.uniforms.uColor.value);
        h.core.material.uniforms.uStrength.value=strength*1.7;
        h.core.material.uniforms.uTime.value=t;
        h.lensMat.emissiveIntensity=1.2+drive*2.6+flash*2+(hit?2.5:0);
        h.flare.material.color.copy(h.haze.material.uniforms.uColor.value);
        h.flare.material.opacity=.1+drive*.55+energy*.15+(hit?.2:0);
        h.flare.scale.setScalar(.55+drive*.7+(hit?.2:0));
        h.g.rotation.y=Math.sin(t*.5+h.phase)*.3;
      });

      // the audience, bouncing with the kick
      crowd.update(dt,t,env.kick,[C.kick,C.clap,C.hat,C.bass,C.chords]);

      // lasers: a fan that snaps to a new pattern every bar and leans with the lead
      const laserLevel=Math.min(.55,.1+Math.max(env.lead,env.ohat)*.45+(sec&&sec.big?.2:0)+env.kick*.06);
      lasers.forEach((l,i)=>{
        l.mat.opacity=Math.min(.38,laserLevel);
        l.dot.material.opacity=laserLevel*.9;
        const a=Math.sin(t*(1.1+i*.05)+l.phase)*.55;
        l.aim.lookAt(Math.sin(l.phase)*8*a,(sec&&sec.big?4.5:2.4)+Math.cos(t*.8+l.phase)*1.6,6);
      });

      // rings leave the stage on every kick
      rings.forEach(r=>{
        if(r.life>0){
          r.life-=dt*.8;
          const k=1-r.life;
          r.ring.scale.setScalar(.6+k*4.2);
          r.m.opacity=Math.max(0,r.life*.42);
          r.ring.position.z=-1.35+k*.5;
        }else r.m.opacity=0;
      });


      // strobe, strip and the wall's ambient pulse
      strobe.intensity=flash*90*(.4+energy*.6);
      stripMat.opacity=.18+env.bass*.6;
      riserLip.material.opacity=.12+env.perc*.4;
      frontFill.intensity=5+env.kick*13;
      key.intensity=6+env.chords*2.5+energy*2;
      djEdge.intensity=5+env.hat*3+energy*2.5+boost*3;
      djFill.intensity=1.4+env.lead*.8+boost*.6;
      rim.intensity=4+env.lead*7;
      wallGlow.material.opacity=.05+boost*.09+env.pad*.07;
      wallGlow.material.color.copy(wash);
      knobs.forEach(k=>{k.material.emissiveIntensity*=.93});

      // the stage-front bars: level-driven, with a floor so they are never fully dark
      for(const b of vu){
        const l=Math.min(1,env[b.part]*1.1+.05);
        b.bar.scale.y=l;
        b.m.opacity=.15+l*.55;
      }

      // ---- the camera: coverage, cut on the music ----
      if(faceCam){
        if(dancer&&dancer.head)dancer.head.getWorldPosition(_v3);
        else{dj.getWorldPosition(_v3);_v3.y+=DJ_H*.93}
        camera.position.set(_v3.x*.5,_v3.y+.02,_v3.z+.8);
        camera.lookAt(_v3.x,_v3.y+.01,_v3.z);
        post.render(t);
        return;
      }
      // A shot holds for its own number of bars, and a new section of the song cuts to the next
      // shot in that section's coverage. Cuts land on section changes, which is where a music
      // video cuts; a drone move eases in instead, because snapping a moving rig looks broken.
      const barSec=60/bpm*4;
      const secName=(sec&&sec.n)||'';
      const secNew=secName!==camSec;
      if(secNew)camSec=secName;
      camT+=dt;
      if(secNew||camT>=(camShot.bars||4)*barSec){
        const pool=shotSet(sec,engaging);
        const next=pool[shotIdx++%pool.length]||camShot;
        const changed=next!==camShot;
        camShot=next;
        camT=0;
        if(changed)camCut=secNew||camShot.kind==='fixed';
      }
      const pose=shotPose(camShot,t,camT/Math.max(.001,(camShot.bars||4)*barSec));
      if(camCut){
        camPos.copy(pose.p);camLook.copy(pose.l);camFov=pose.fov;camCut=false;
      }else{
        const k=Math.min(1,dt*(camShot.kind==='orbit'?1.2:2.4));
        camPos.lerp(pose.p,k);
        camLook.lerp(pose.l,k);
        camFov+=(pose.fov-camFov)*Math.min(1,dt*1.6);
      }

      // the shake: two slow sines per axis, so it pushes rather than jitters, and the bass sets
      // how hard. Amp is in metres — a few centimetres reads as a hand on the tripod.
      const shake=Math.min(1.7,env.bass*.6+env.kick*.8+(sec&&sec.big?.5:0));
      const sx=(Math.sin(t*21.3)+Math.sin(t*9.1)*.6)*.5;
      const sy=(Math.sin(t*17.7+1.7)+Math.sin(t*6.9)*.6)*.5;
      const amp=.05*shake;
      camera.position.set(
        camPos.x+sx*amp,
        camPos.y+Math.sin(t*.19)*.04+sy*amp*.7,
        camPos.z-dropEnv*.3);
      camTarget.copy(camLook);
      camTarget.x+=sx*amp*.3;
      camTarget.y+=sy*amp*.25;
      camera.lookAt(camTarget);
      // a light roll, so the horizon tips with the bass instead of the picture sliding sideways
      camera.rotateZ(Math.sin(t*.31)*.006+env.bass*.016*sx);
      const fovNow=camFov-dropEnv*1.6-env.kick*.4;
      if(Math.abs(camera.fov-fovNow)>1e-3){camera.fov=fovNow;camera.updateProjectionMatrix()}
      post.render(t);
    }
    requestAnimationFrame(frame);

    // ---- captions ----
    // A #stage link loads with this view already visible and nothing has called setActive yet,
    // so adopt the current view here instead.
    const sv=document.getElementById('stageView');
    active=!!(sv&&!sv.hidden);
    if(active)loadDancer();
    function caption(){
      const bl=window.__bl;
      if(!bl||!bl.isPlaying||!bl.isPlaying()){
        stateEl.textContent='Idle · press Start the set';
      }else{
        const s=window.__stage.state();
        stateEl.textContent=(s.section?s.section+' · ':'')+'step '+(s.step+1)+'/16';
      }
    }
    setInterval(caption,400);
    caption();
    if(cap)cap.textContent='The set keeps playing here: this view only listens, and the dance follows the audio clock.';
  }

  // ---- transport buttons for the stage ----
  const bl=()=>window.__bl;
  const splay=document.getElementById('splay');
  const snext=document.getElementById('snext');
  if(splay)splay.addEventListener('click',()=>{
    const b=bl();if(!b)return;
    if(!b.isPlaying()){b.buildNow();b.play()}
    else b.pause();
    splay.textContent=b.isPlaying()?'Pause the set':'Start the set';
  });
  if(snext)snext.addEventListener('click',()=>{
    const b=bl();if(!b)return;
    const seed=((Math.random()*9000)|0)+1000;
    b.run(seed,b.state().want||'');
    b.buildNow();b.play();
    if(splay)splay.textContent='Pause the set';
  });
  setInterval(()=>{
    const b=bl();if(!b||!splay)return;
    splay.textContent=b.isPlaying()?'Pause the set':'Start the set';
  },500);
}
