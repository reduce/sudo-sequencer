// ---------- stage effects ----------
// Everything here is additive light or post-processing; none of it touches the audio.
//   createPost()      bloom + a terminal grade (aberration, scanlines, grain, vignette, glitch)
//   beamMaterial()    a fake-volumetric cone: brightest at the lens, soft at the silhouette
//   radialTexture()   a soft dot, used by beams, glows and phone lights
//   makeCrowd()       rows of silhouettes with phone lights, bouncing on the kick. Unused by the
//                     stage now (a crowd that close is either dot noise or a wall of shapes), but
//                     kept because it is the obvious starting point if you want one back.
import * as THREE from 'three';
import {EffectComposer} from './vendor/postprocessing/EffectComposer.js';
import {RenderPass} from './vendor/postprocessing/RenderPass.js';
import {UnrealBloomPass} from './vendor/postprocessing/UnrealBloomPass.js';
import {ShaderPass} from './vendor/postprocessing/ShaderPass.js';
import {OutputPass} from './vendor/postprocessing/OutputPass.js';

// ---------------------------------------------------------------- grade / CRT pass
const GradeShader={
  uniforms:{
    tDiffuse:{value:null}, uTime:{value:0}, uBoost:{value:0}, uGlitch:{value:0},
    uAberr:{value:0.0007}, uScan:{value:0.10}, uGrain:{value:0.03}, uVig:{value:1.05}
  },
  vertexShader:`
    varying vec2 vUv;
    void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
  `,
  fragmentShader:`
    uniform sampler2D tDiffuse;
    uniform float uTime,uBoost,uGlitch,uAberr,uScan,uGrain,uVig;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }
    void main(){
      vec2 uv=vUv;
      // slight barrel, like a big glass tube
      vec2 c=uv-0.5;
      uv=0.5+c*(1.0+0.055*dot(c,c));
      // horizontal tear on hard hits
      float band=step(0.995-uGlitch*0.06,hash(vec2(floor(uv.y*90.0),floor(uTime*18.0))));
      uv.x+=band*uGlitch*0.012;
      // chromatic aberration grows with the boost
      float ab=uAberr*(1.0+uBoost*1.1);
      vec3 col;
      col.r=texture2D(tDiffuse,uv+vec2(ab,0.0)).r;
      col.g=texture2D(tDiffuse,uv).g;
      col.b=texture2D(tDiffuse,uv-vec2(ab,0.0)).b;
      // scanlines + a slow rolling bright line
      float s=0.5+0.5*sin(uv.y*1400.0);
      col*=1.0-uScan*0.28*s;
      float roll=fract(uTime*0.06);
      col+=vec3(0.02,0.06,0.07)*smoothstep(0.0,0.02,abs(uv.y-roll))*0.5;
      // grain
      float g=hash(uv*vec2(1920.0,1080.0)+uTime);
      col+= (g-0.5)*uGrain;
      // vignette
      vec2 d=uv-0.5;
      col*=smoothstep(0.95,0.18,length(d)*uVig);
      // cool the shadows, warm the highlights
      col=mix(col,col*vec3(0.86,0.95,1.12),smoothstep(0.5,0.0,dot(col,vec3(0.33))));
      col=mix(col,col*vec3(1.08,1.0,0.95),smoothstep(0.45,1.0,dot(col,vec3(0.33))));
      gl_FragColor=vec4(col,1.0);
    }
  `
};

export function createPost(renderer,scene,camera){
  const size=new THREE.Vector2();
  renderer.getSize(size);
  const composer=new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene,camera));
  const bloom=new UnrealBloomPass(new THREE.Vector2(size.x,size.y),0.36,0.34,0.94);
  composer.addPass(bloom);
  const grade=new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  return {
    composer,bloom,
    uniforms:grade.uniforms,
    setSize(w,h){composer.setSize(w,h);bloom.setSize(w,h)},
    setBoost(b){                     // 0..1, from the game layer
      const k=Math.max(0,Math.min(1.6,b));
      bloom.strength=0.26+k*0.62;
      bloom.radius=0.30+k*0.22;
      grade.uniforms.uBoost.value=k;
      grade.uniforms.uGlitch.value=k*0.55;
    },
    render(t){grade.uniforms.uTime.value=t;composer.render()}
  };
}

// ---------------------------------------------------------------- soft dot texture
let dotTex=null;
export function radialTexture(size=128){
  if(dotTex)return dotTex;
  const c=document.createElement('canvas');
  c.width=c.height=size;
  const x=c.getContext('2d');
  const g=x.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);
  g.addColorStop(0,'rgba(255,255,255,1)');
  g.addColorStop(.22,'rgba(255,255,255,.72)');
  g.addColorStop(.55,'rgba(255,255,255,.17)');
  g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=g;x.fillRect(0,0,size,size);
  dotTex=new THREE.CanvasTexture(c);
  dotTex.colorSpace=THREE.SRGBColorSpace;
  return dotTex;
}

// ---------------------------------------------------------------- volumetric cone
const BEAM_VS=`
  varying vec3 vN; varying vec3 vV; varying vec2 vUv;
  void main(){
    vec4 wp=modelMatrix*vec4(position,1.0);
    vN=normalize(mat3(modelMatrix)*normal);
    vV=normalize(cameraPosition-wp.xyz);
    vUv=uv;
    gl_Position=projectionMatrix*viewMatrix*wp;
  }
`;
const BEAM_FS=`
  uniform vec3 uColor; uniform float uStrength; uniform float uTime; uniform float uNoise;
  varying vec3 vN; varying vec3 vV; varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }
  void main(){
    // soft silhouette: grazing rays are brighter than the cone's face
    float edge=1.0-abs(dot(normalize(vN),normalize(vV)));
    edge=pow(clamp(edge,0.0,1.0),1.7);
    // uv.y runs base -> apex; the lens end is the hot end
    float axial=smoothstep(0.02,0.6,vUv.y);
    axial*=mix(0.30,1.0,vUv.y);
    // haze flicker, so the beam breathes rather than glows flat
    float flick=0.86+0.14*sin(uTime*23.0+vUv.y*18.0+vUv.x*6.28);
    float n=mix(1.0,0.65+0.7*hash(vec2(vUv.y*9.0,floor(uTime*13.0))),uNoise);
    float a=edge*axial*flick*n*uStrength;
    gl_FragColor=vec4(uColor*a,a);
  }
`;
export function beamMaterial(color,opts){
  return new THREE.ShaderMaterial({
    uniforms:{
      uColor:{value:new THREE.Color(color)},uStrength:{value:0.5},
      uTime:{value:0},uNoise:{value:opts&&opts.noise!=null?opts.noise:0.55}
    },
    vertexShader:BEAM_VS,fragmentShader:BEAM_FS,
    transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide
  });
}

// ---------------------------------------------------------------- crowd
// Rows of silhouettes with phone lights. The bands say where the room's people stand, so the
// stage can put a foreground row along the bottom of the frame and a deeper row behind it.
export function makeCrowd(count=220,bands){
  const group=new THREE.Group();
  const bodyGeo=new THREE.CapsuleGeometry(.2,1.05,4,10);   // 1.45 m from the floor, head included
  bodyGeo.translate(0,.725,0);                              // base on the floor, not through it
  const bodyMat=new THREE.MeshStandardMaterial({color:0x27303f,roughness:.9,metalness:.08});
  const bodies=new THREE.InstancedMesh(bodyGeo,bodyMat,count);
  bodies.frustumCulled=false;
  // each phone is a small additive quad, so the dots read as screens in the dark
  const armGeo=new THREE.PlaneGeometry(.055,.034);
  const armMat=new THREE.MeshBasicMaterial({map:radialTexture(64),color:0xffffff,
    transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,opacity:.95});
  const lights=new THREE.InstancedMesh(armGeo,armMat,count);
  lights.frustumCulled=false;

  const rows=(bands&&bands.length)?bands:[{z0:-1.9,z1:-.9,x0:.8,x1:5}];
  const people=[];
  const per=Math.ceil(count/rows.length);
  rows.forEach(b=>{
    for(let i=0;i<per&&people.length<count;i++){
      const side=Math.random()<.5?-1:1;
      people.push({
        x:side*(b.x0+Math.random()*(b.x1-b.x0)),
        z:b.z0+Math.random()*(b.z1-b.z0),
        phase:Math.random()*Math.PI*2,
        scale:.92+Math.random()*.2,
        has:Math.random()<.14,
        lift:.05+Math.random()*.24,
        sway:.5+Math.random()*.7
      });
    }
  });
  const m=new THREE.Matrix4(),q=new THREE.Quaternion(),s=new THREE.Vector3(),p=new THREE.Vector3();
  const axis=new THREE.Vector3(0,1,0),c=new THREE.Color();
  return {
    group,people,bodies,lights,
    update(dt,t,kick,colors){
      const n=people.length;
      for(let i=0;i<n;i++){
        const P=people[i];
        const bob=Math.abs(Math.sin(t*(1.5+kick*3)+P.phase))*(.05+kick*.13)*P.scale;
        // feet on the floor, body bobbing from there
        p.set(P.x,bob,P.z);
        s.set(P.scale*.94,P.scale*(1+kick*.045),P.scale*.94);
        q.setFromAxisAngle(axis,Math.sin(t*.6+P.phase)*.24*P.sway);
        m.compose(p,q,s);
        bodies.setMatrixAt(i,m);
        if(P.has){
          p.set(P.x+Math.sin(P.phase)*.1,1.3*P.scale+bob+P.lift,P.z+.06);
          s.set(1,1,1);q.identity();
          m.compose(p,q,s);
          lights.setMatrixAt(i,m);
          c.set(colors[i%colors.length]);
          lights.setColorAt(i,c);
        }else{
          p.set(0,-99,0);s.set(0,0,0);q.identity();
          m.compose(p,q,s);
          lights.setMatrixAt(i,m);
        }
      }
      bodies.instanceMatrix.needsUpdate=true;
      lights.instanceMatrix.needsUpdate=true;
      if(lights.instanceColor)lights.instanceColor.needsUpdate=true;
    }
  };
}

// ---------------------------------------------------------------- reflection environment
// A handful of emissive panels rendered once into a PMREM cube: enough for the floor and the
// decks to pick up the palette without rendering the scene twice every frame.
export function paletteEnvironment(renderer,colors){
  const pmrem=new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const s=new THREE.Scene();
  s.background=new THREE.Color(0x02040a);
  const panel=(c,x,y,z,w,h,ry)=>{
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),
      new THREE.MeshBasicMaterial({color:c,side:THREE.DoubleSide}));
    m.position.set(x,y,z);m.rotation.y=ry||0;s.add(m);
  };
  colors.slice(0,6).forEach((c,i)=>{
    const a=i/6*Math.PI*2;
    panel(c,Math.cos(a)*9,2.2+Math.sin(i)*1.6,Math.sin(a)*9,3.4,1.2,-a+Math.PI/2);
  });
  panel(0x0a1020,0,6,0,30,30);
  const tex=pmrem.fromScene(s,0).texture;
  pmrem.dispose();
  return tex;
}
