
// ---------- MIDI and zip writers (shared by both views) ----------
function vlq(n){const b=[n&127];while(n>>=7)b.unshift(n&127|128);return b}
function midiBytes(tracks,ppq){const out=[77,84,104,100,0,0,0,6,0,1,0,tracks.length,ppq>>8,ppq&255];
  for(const ev of tracks){ev.sort((a,b)=>a.k-b.k||a.o-b.o);const d=[];let last=0;
    for(const e of ev){const v=vlq(e.k-last);for(const x of v)d.push(x);for(const x of e.b)d.push(x);last=e.k}
    d.push(0,255,47,0);out.push(77,84,114,107,d.length>>>24&255,d.length>>>16&255,d.length>>>8&255,d.length&255);for(const x of d)out.push(x)}
  return new Uint8Array(out)}
const CRCT=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
function crc32(u){let c=0xFFFFFFFF;for(let i=0;i<u.length;i++)c=CRCT[(c^u[i])&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0}
function zipStore(files){const le16=n=>[n&255,n>>8&255],le32=n=>[n&255,n>>>8&255,n>>>16&255,n>>>24&255],parts=[],cen=[];let off=0;
  for(const f of files){const nm=Array.from(f.name,c=>c.charCodeAt(0)&127),crc=crc32(f.data),sz=f.data.length,common=[].concat(le16(20),le16(0),le16(0),le16(0),le16(0x21),le32(crc),le32(sz),le32(sz),le16(nm.length),le16(0));
    const h=[80,75,3,4].concat(common,nm);parts.push(new Uint8Array(h),f.data);
    cen.push(new Uint8Array([80,75,1,2].concat(le16(20),common,le16(0),le16(0),le16(0),le32(0),le32(off),nm)));off+=h.length+sz}
  let cl=0;for(const c of cen){parts.push(c);cl+=c.length}
  parts.push(new Uint8Array([80,75,5,6,0,0,0,0].concat(le16(files.length),le16(files.length),le32(cl),le32(off),[0,0])));
  let n=0;for(const p of parts)n+=p.length;const out=new Uint8Array(n);let o=0;for(const p of parts){out.set(p,o);o+=p.length}return out}

// ---------- piano: the score, written note by note, and the performance model (no DOM, no audio) ----------
// Notation: pitch:length in sixteenth notes. r = rest. x+y = chord. T(main,upper) = trill.
// Left-hand shorthands, each one half bar of eighth notes: A = Alberti bass (low high mid high), B = broken chord (low mid high mid),
// D = bass note then three repeated pairs, O = broken octave.
const PN=(function(){
const NM={c:0,d:2,e:4,f:5,g:7,a:9,b:11};
function pm(s){const m=/^([a-g])([#b]?)(\d)$/.exec(s);if(!m)throw new Error('bad note '+s);return 12*(+m[3]+1)+NM[m[1]]+(m[2]==='#'?1:m[2]==='b'?-1:0)}
const P1={n:'First theme',part:'Exposition',k:'G major',
 rh:['b4:6 c5:2 d5:4 g5:4','f#5:6 e5:2 d5:4 c5:4','b4:2 d5:2 g5:2 b5:2 a5:2 g5:2 f#5:2 e5:2','d5:8 r:8',
     'b4:6 c5:2 d5:4 g5:4','f#5:6 e5:2 d5:4 c5:4','b4:2 d5:2 g5:2 b5:2 c6:4 a5:2 f#5:2','g5:8 r:8'],
 lh:['A(g3,b3,d4)*2','A(a3,c4,d4) A(a3,d4,f#4)','A(g3,b3,d4) c3:2 a3:2 d3:2 a3:2','A(d3,f#3,a3) d3:4 r:4',
     'A(g3,b3,d4)*2','A(a3,c4,d4) A(a3,d4,f#4)','A(g3,b3,d4) c3:2 e3+a3:2 d3:2 a3+c4:2','g2:4 g3+b3+d4:4 r:8'],
 dyn:'4 4 4.4 3.6 4 4.2 4.8 4.2',ped:'dd dd h- h- dd dd h- h-',ph:[4,4],rit:[.05,.08],tm:1,br:0};
const TR={n:'Transition',part:'Exposition',k:'G to D major',
 rh:['g4:1 a4:1 b4:1 c5:1 d5:1 e5:1 f#5:1 g5:1 b5:2 g5:2 d5:2 b4:2','e4:1 f#4:1 g4:1 a4:1 b4:1 c5:1 d5:1 e5:1 g5:2 e5:2 b4:2 g4:2',
     'e4:1 f#4:1 g#4:1 a4:1 b4:1 c#5:1 d5:1 e5:1 g#5:2 e5:2 d5:2 b4:2','c#5+e5+a5:4 c#5+e5+a5:4 c#5+e5+a5:4 r:4'],
 lh:['g2:4 g3+b3+d4:4 g3+b3+d4:4 g3+b3+d4:4','e2:4 e3+g3+b3:4 e3+g3+b3:4 e3+g3+b3:4','e2:4 e3+g#3+d4:4 e3+b3+d4:4 e3+b3+d4:4','a2+a3:4 a2+a3:4 a2+a3:4 r:4'],
 dyn:'s4.6 4.8 5.2 5.4',ped:'-h -h -h --',ph:[4],rit:[.04],tm:1.02,br:.06};
const S1={n:'Second theme',part:'Exposition',k:'D major',
 rh:['f#5:8 a5:4 g5:2 f#5:2','e5:8 g5:4 f#5:2 e5:2','g5:8 b5:4 a5:2 g5:2','f#5:8 d5:4 r:4',
     'b5:4 a5:2 g5:2 a5:4 g5:2 f#5:2','g5:6 f#5:2 e5:1 f#5:1 g5:1 a5:1 b5:1 c#6:1 d6:1 e6:1','d6:2 a5:2 f#5:2 d5:2 T(e5,f#5):6 d5:1 e5:1','d5:8 r:8'],
 lh:['B(d3,a3,f#4)*2','B(c#3,a3,e4)*2','B(a2,e3,c#4)*2','B(d3,a3,f#4)*2','B(g2,d3,b3) B(f#2,d3,a3)','B(e2,b2,g3) B(g2,e3,b3)','B(a2,f#3,d4) B(a2,g3,c#4)','B(d3,a3,f#4) d3:4 r:4'],
 dyn:'s2.4 2.4 2.8 2.5 3 3.6 4.6 4.2',ped:'Pd Pd Pd Pd dd d- Ph P-',ph:[4,4],rit:[.05,.1],tm:.965,br:0};
const C1={n:'Closing',part:'Exposition',k:'D major',
 rh:['d5:2 f#5:2 a5:2 d6:2 c#6:2 a5:2 g5:2 e5:2','d5:2 f#5:2 a5:2 d6:2 c#6:2 a5:2 g5:2 e5:2','r:1 d5:1 e5:1 f#5:1 g5:1 a5:1 b5:1 c#6:1 d6:4 r:4','f#5+a5+d6:4 r:4 f#4+a4+d5:4 r:4'],
 lh:['D(d3,f#3+a3) D(a2,e3+a3)','D(d3,f#3+a3) D(a2,e3+a3)','D(d3,f#3+a3) d3:4 r:4','d3+a3:4 r:4 d2+d3:4 r:4'],
 dyn:'s5 5 5.2 5.4',ped:'PP PP -d --',ph:[4],rit:[.07],tm:1.02,br:.15};
const DV={n:'Development',part:'Development',k:'moving keys',
 rh:['d#5:6 e5:2 f#5:4 b5:4','b5:6 a5:2 g5:4 e5:4','c#5:6 d5:2 e5:4 a5:4','a5:6 g5:2 f#5:4 d5:4',
     'e5:2 g5:2 b5:4 e5:2 g5:2 c6:4','e5:2 g5:2 bb5:4 g5:2 bb5:2 e6:4','d6:8 c6:4 a5:4','f#5:4 d5:4 c5:4 r:4'],
 lh:['A(b2,f#3,a3)*2','A(e3,g3,b3)*2','A(a2,e3,g3)*2','A(d3,f#3,a3)*2','D(e3,g3+b3) D(c3,e3+g3)','D(c#3,g3+bb3)*2','O(d2)*2','O(d2) d2+d3:4 r:4'],
 dyn:'s3 3 3.4 3.6 4.2 4.8 5.4 4.4',ped:'dd dd dd dd PP PP PP P-',ph:[4,4],rit:[.03,.22],tm:1,br:.22};
const P2=Object.assign({},P1,{part:'Recapitulation',dyn:'3.8 4 4.4 3.6 4 4.2 4.8 4.2'});
const TR2={n:'Transition',part:'Recapitulation',k:'G major',
 rh:['c5:1 d5:1 e5:1 f#5:1 g5:1 a5:1 b5:1 c6:1 e6:2 c6:2 g5:2 e5:2','a4:1 b4:1 c5:1 d5:1 e5:1 f#5:1 g5:1 a5:1 c6:2 a5:2 e5:2 c5:2',
     'a4:1 b4:1 c#5:1 d5:1 e5:1 f#5:1 g5:1 a5:1 c#6:2 a5:2 g5:2 e5:2','f#5+a5+d6:4 f#5+a5+d6:4 f#5+a5+d6:4 r:4'],
 lh:['c3:4 c4+e4+g4:4 c4+e4+g4:4 c4+e4+g4:4','a2:4 a3+c4+e4:4 a3+c4+e4:4 a3+c4+e4:4','a2:4 a3+c#4+g4:4 a3+e4+g4:4 a3+e4+g4:4','d2+d3:4 d2+d3:4 d2+d3:4 r:4'],
 dyn:'s4.6 4.8 5.2 5.4',ped:'-h -h -h --',ph:[4],rit:[.04],tm:1.02,br:.06};
const S2=Object.assign({},S1,{part:'Recapitulation',k:'G major',sh:-7,
 lh:['B(g2,d3,b3)*2','B(f#2,d3,a3)*2','B(d3,a3,f#4)*2','B(g2,d3,b3)*2','B(c3,g3,e4) B(b2,g3,d4)','B(a2,e3,c4) B(c3,a3,e4)','B(d3,g3,b3) B(d3,f#3,c4)','B(g2,d3,b3) g2:4 r:4']});
const C2={n:'Closing',part:'Recapitulation',k:'G major',
 rh:['g4:2 b4:2 d5:2 g5:2 f#5:2 d5:2 c5:2 a4:2','g5:2 b5:2 d6:2 g6:2 f#6:2 d6:2 c6:2 a5:2','r:1 g5:1 a5:1 b5:1 c6:1 d6:1 e6:1 f#6:1 g6:4 r:4','b5+d6+g6:4 r:4 b4+d5+g5:8'],
 lh:['D(g2,b3+d4) D(d3,a3+d4)','D(g2,b3+d4) D(d3,a3+d4)','D(g2,b3+d4) g2:4 r:4','g2+g3:4 r:4 g1+g2:8'],
 dyn:'s5 5.2 5.4 5.6',ped:'PP PP -d -P',ph:[4],rit:[.28],tm:1.02,br:0};
const SEC=[P1,TR,S1,C1,DV,P2,TR2,S2,C2];

function parseBar(str,bar,hand,sh,out){let t=bar*16;const t0=t;
  for(const tok of str.split(/\s+/)){let m;
    if(m=/^([ABDO])\(([^)]*)\)(?:\*(\d))?$/.exec(tok)){const P=m[2].split(',').map(x=>x.split('+').map(y=>pm(y)+sh)),ty=m[1];
      const seq=ty==='A'?[P[0],P[2],P[1],P[2]]:ty==='B'?[P[0],P[1],P[2],P[1]]:ty==='D'?[P[0],P[1],P[1],P[1]]:[P[0],[P[0][0]+12],P[0],[P[0][0]+12]];
      for(let r=0;r<+(m[3]||1);r++){seq.forEach((ps,k)=>ps.forEach((p,j)=>out.push({t:t+k*2,d:2,p,hand,role:ty==='O'||k===0?'bass':'acc',hold:k===0&&(ty==='A'||ty==='B')?8:0,ci:j,cn:ps.length,mac:ty})));t+=8}}
    else if(m=/^T\(([^,]+),([^)]+)\):(\d+)$/.exec(tok)){const main=pm(m[1])+sh,up=pm(m[2])+sh,d=+m[3],n=Math.round(d/.75),u=d/n;
      for(let k=0;k<n;k++)out.push({t:t+k*u,d:u,p:k%2?main:up,hand,role:'mel',tr:1,ci:0,cn:1});t+=d}
    else{const q=tok.split(':'),d=+q[1];if(!(d>0))throw new Error('bad token '+tok);
      if(q[0]!=='r'){const P=q[0].split('+').map(x=>pm(x)+sh).sort((a,b)=>a-b);
        P.forEach((p,j)=>out.push({t,d,p,hand,ci:j,cn:P.length,role:hand===0?(j===P.length-1?'mel':'inner'):(P.length===1||(P.length===2&&P[1]-P[0]===12))?'bass':'acc'}))}
      t+=d}}
  if(Math.abs(t-t0-16)>1e-6)throw new Error('bar '+(bar+1)+(hand?' left':' right')+' hand has '+(t-t0)+' sixteenths')}

const notes=[],secs=[],dyn=[],ped=[],phr=[],phOf=[];let bar=0;
for(const s of SEC){const nb=s.rh.length;secs.push({n:s.n,part:s.part,k:s.k,a:bar,b:bar+nb});
  s.dyn.split(' ').forEach(x=>dyn.push({s:x[0]==='s',v:parseFloat(x.replace('s',''))}));
  s.ped.split(' ').forEach(x=>ped.push(x[0],x[1]));
  let a=bar;s.ph.forEach((len,i)=>{for(let b=a;b<a+len;b++)phOf[b]=phr.length;phr.push({a,b:a+len,rit:s.rit[i],tm:s.tm,br:i===s.ph.length-1?s.br:0});a+=len});
  for(let i=0;i<nb;i++){parseBar(s.rh[i],bar,0,s.sh||0,notes);parseBar(s.lh[i],bar,1,0,notes);bar++}}
const NB=bar,N16=NB*16;
notes.sort((a,b)=>a.t-b.t||a.hand-b.hand||a.p-b.p);
(function(){const rh=notes.filter(n=>n.hand===0),on={},key=t=>t.toFixed(3);
  rh.forEach(n=>(on[key(n.t)]=on[key(n.t)]||[]).push(n.p));
  rh.forEach(n=>{const nx=on[key(n.t+n.d)];if(!nx)n.gap=1;else if(nx.indexOf(n.p)>=0)n.rep=1});
  phr.forEach(p=>{let last=null;for(const n of rh)if(n.role==='mel'&&!n.tr&&n.cn===1&&n.t>=p.a*16&&n.t<p.b*16)last=n;if(last)last.last=1})})();

// One take = one seeded performance. opt switches the three layers on or off.
function perform(seed,opt){
  const r=rngFrom((seed*2246822519)>>>0),gs=()=>{const g=(r()+r()+r()+r()-2)*1.732;return g>2?2:g<-2?-2:g};
  const K={bpm:ri(r,120,132),rub:rf(r,.025,.055),rit:rf(r,.8,1.25),lead:rf(r,.008,.02),jit:rf(r,.0035,.007),spread:rf(r,.003,.008),dynS:rf(r,.88,1.15),vn:rf(r,.12,.22),pedP:ri(r,100,127),pedH:ri(r,56,78),pedD:rf(r,.06,.11),ov:rf(r,.01,.035)};
  // timing: phrase-arch tempo, slowing at cadences, short breaths between sections
  const base=60/K.bpm/4,sd=new Float64Array(N16),T=new Float64Array(N16+1),br=new Float64Array(N16+1);
  for(const p of phr){const len=(p.b-p.a)*16,w=Math.min(.5,12/len);
    for(let i=0;i<len;i++){let m=1;if(opt.time){const x=(i+.5)/len;m=p.tm*(1+K.rub*(Math.sin(Math.PI*x)-.637));if(x>1-w){const q=(x-(1-w))/w;m*=1-Math.min(.45,p.rit*K.rit)*q*q}}sd[p.a*16+i]=base/m}
    if(opt.time&&p.br)br[p.b*16]=p.br}
  T[0]=.15;for(let i=0;i<N16;i++)T[i+1]=T[i]+sd[i]+br[i+1];
  const at=(pos,end)=>{if(pos>=N16)return T[N16]-br[N16];const i=Math.floor(pos),f=pos-i;return end&&f===0&&i>0?T[i]-br[i]:T[i]+f*sd[i]};
  const scoreAt=sec=>{let a=0,b=N16;if(sec<=T[0])return 0;if(sec>=T[b])return N16;while(b-a>1){const m=(a+b)>>1;if(T[m]<=sec)a=m;else b=m}return a+Math.min(1,(sec-T[a])/sd[a])};
  const lev=t=>{const b=Math.min(NB-1,Math.floor(t/16)),f=t/16-b,a=dyn[b].v,nx=dyn[b+1],e=nx&&!nx.s?nx.v:a;return 4+((a+(e-a)*f)-4)*K.dynS};
  const out=[];
  for(const n of notes){const b=Math.min(NB-1,Math.floor(n.t/16)),p=phr[phOf[b]],x=(n.t-p.a*16)/((p.b-p.a)*16),st=n.t%16;
    let vel=80;
    if(opt.dyn){let L=lev(n.t)+.35*K.dynS*(Math.sin(Math.PI*x)-.637);            // marked level plus phrase swell
      if(st===0)L+=.25;else if(st===8)L+=.12;else if(st%4!==0)L-=st%2===0?.05:.12;  // metre
      if(n.role==='mel'){L+=.045*(n.p-74);if(n.tr)L-=.7;if(n.last)L-=.45}          // tune on top, higher is louder
      else L-=n.role==='inner'?.9:n.role==='bass'?.8:1.3;                          // accompaniment underneath
      L+=gs()*K.vn;vel=Math.max(10,Math.min(125,Math.round(20+15*L)))}
    const s0=at(n.t),e0=at(n.t+n.d,true);let on=s0,off;
    if(opt.time){let f=0;
      if(n.role==='mel'&&n.cn===1&&!n.tr)on-=K.lead;                               // melody lead
      if(n.cn>1)on+=n.ci*K.spread*(.6+.8*r());                                     // chords are never perfectly together
      on+=gs()*K.jit*(n.tr?.4:n.d<=1?.7:1);                                        // motor noise
      if(n.hold)off=on+(at(n.t+n.hold,true)-s0)*.94;                               // held bass under broken chords
      else if(n.hand===0){if(n.tr)f=.97;else if(n.cn>=3&&n.d<=4)f=.5;else if(n.d<=1)f=.86;else if(n.gap)f=.88;else if(n.rep)f=.8;else off=e0+K.ov}
      else f=n.mac==='D'?(n.role==='bass'?.9:.55):n.mac==='O'?.8:n.mac?.92:n.role==='bass'?.85:.55;
      if(f)off=on+(e0-s0)*f}
    else off=s0+(e0-s0)*.95;
    out.push({t:n.t,d:n.d,p:n.p,hand:n.hand,role:n.role,on,off,vel})}
  const byP={};for(const n of out)(byP[n.p]=byP[n.p]||[]).push(n);
  for(const k in byP){const a=byP[k].sort((x,y)=>x.on-y.on);for(let i=0;i<a.length-1;i++)if(a[i].off>a[i+1].on-.012)a[i].off=Math.max(a[i].on+.02,a[i+1].on-.012)}
  // pedal: down just after the new harmony, up as the next one starts; d = short dab on the beat
  const pe=[];let pedN=0;
  if(opt.ped)for(let h=0;h<NB*2;h++){const c=ped[h];if(c==='-')continue;const v=c==='P'?K.pedP:c==='h'?K.pedH:Math.round((K.pedP+K.pedH)/2),dn=at(h*8)+(opt.time?K.pedD:.03),nx=ped[h+1];
    const up=h===NB*2-1?at(N16,true)+1.6:c==='d'?at(h*8+4,true)-.04:nx&&nx!=='-'?at((h+1)*8):at((h+1)*8,true)-.05;
    pe.push({t:dn,v:Math.round(v*.5)},{t:dn+.03,v},{t:up,v:Math.round(v*.4)},{t:up+.025,v:0});pedN++}
  const iv=[];let a0=-1;for(const e of pe){if(e.v>=40&&a0<0)a0=e.t;else if(e.v<40&&a0>=0){iv.push([a0,e.t]);a0=-1}}
  for(const n of out){n.rel=n.off;for(const q of iv){if(q[0]>n.off)break;if(n.off<q[1]){n.rel=q[1];break}}}
  out.sort((x,y)=>x.on-y.on);
  return{seed,opt,K,notes:out,ped:pe,pedN,T,sd,at,scoreAt,dur:at(N16,true)+(opt.ped?1.6:.3)}}

function midi(pf){const ppq=960,bpm=pf.K.bpm,tk=s=>Math.max(0,Math.round(s*ppq*bpm/60)),us=Math.round(6e7/bpm),tx=s=>Array.from(s,c=>c.charCodeAt(0)&127);
  const meta=(k,ty,d)=>({k,o:0,b:[255,ty].concat(vlq(d.length),d)});
  const t0=[meta(0,3,tx('Sonatina in G major - Allegro')),meta(0,0x51,[us>>16&255,us>>8&255,us&255]),meta(0,0x58,[4,2,24,8]),meta(0,0x59,[1,0])];
  secs.forEach(s=>t0.push(meta(tk(pf.at(s.a*16)),6,tx(s.part+': '+s.n))));
  const t1=[meta(0,3,tx('Piano')),{k:0,o:1,b:[0xC0,0]}];
  for(const n of pf.notes){const a=tk(n.on);t1.push({k:a,o:3,b:[0x90,n.p,n.vel]},{k:Math.max(a+1,tk(n.off)),o:0,b:[0x80,n.p,0]})}
  for(const e of pf.ped)t1.push({k:tk(e.t),o:2,b:[0xB0,64,e.v]});
  return midiBytes([t0,t1],ppq)}
return{score:{notes,secs,NB,N16,phr,ped,dyn},perform,midi}})();
