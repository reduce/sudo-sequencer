
// ---------- pure logic: instruments, styles, genome, rules, search, arrangement (no DOM, no audio) ----------
const W=[5,1,2,1,3,1,2,1,4,1,2,1,3,1,2,1];            // metrical weight of each 16th step
const IDS=['kick','clap','hat','ohat','perc','bass','chords','pad','arp','lead'];
const PASS2=['hat','perc','bass','chords','arp','lead'];
const LV=[0,.35,.7,1];                                  // hit level 0..3 -> loudness
const BANDS=['Sub','Bass','Low mid','Mid','High','Air'];
const F0={kick:[1,.5,.15,.05,.03,.01],clap:[0,.01,.15,.5,.3,.1],hat:[0,0,0,.004,.06,.2],ohat:[0,0,0,.006,.08,.2],perc:[0,.03,.24,.15,.06,.015],bass:[.48,.6,.3,.09,.02,0],chords:[0,.08,.36,.32,.12,.02],pad:[0,.04,.2,.2,.06,.01],arp:[0,0,.06,.22,.14,.03],lead:[0,.015,.15,.3,.15,.03]};
const NOTE=['C','D♭','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
const MAJ=[0,2,4,5,7,9,11];
const SCALES={'natural minor':[0,2,3,5,7,8,10],'Dorian':[0,2,3,5,7,9,10],'Phrygian':[0,1,3,5,7,8,10],'harmonic minor':[0,2,3,5,7,8,11],'major':[0,2,4,5,7,9,11],'Mixolydian':[0,2,4,5,7,9,10]};
const BAD={'natural minor':[1],'Dorian':[5],'Phrygian':[4],'harmonic minor':[1,2,6],'major':[6],'Mixolydian':[2]};   // degrees whose triad is diminished or augmented
const BOFF=[0,4,7,2];                                    // bass choices in scale steps: root, fifth, octave, third
function rngFrom(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const ri=(r,a,b)=>a+Math.floor(r()*(b-a+1));
const rf=(r,a,b)=>a+r()*(b-a);
const pick=(r,a)=>a[Math.floor(r()*a.length)];
const c01=x=>x<0?0:x>1?1:x;
const near=(x,t,w)=>{const d=(x-t)/(w/2);return 1/(1+d*d)};   // 1 at the target, 0.5 at half the width, never flat
const mtof=m=>440*Math.pow(2,(m-69)/12);
const cnt=b=>{let n=0;for(let i=0;i<b.length;i++)if(b[i])n++;return n};
const has=(p,i)=>p[i]>0?1:0;
const bin=p=>p.map(v=>v>=0?1:0);
function sync(b){let s=0;for(let i=0;i<16;i++){if(!b[i])continue;let j=(i+1)%16,mx=0;while(!b[j]&&j!==i){if(W[j]>mx)mx=W[j];j=(j+1)%16}if(mx>W[i])s+=mx-W[i]}return s}
function evenness(b){const pos=[];for(let i=0;i<16;i++)if(b[i])pos.push(i);const k=pos.length;if(k<2)return k?1:0;const ideal=16/k;let d=0;for(let i=0;i<k;i++){const ioi=((pos[(i+1)%k]-pos[i])+16)%16||16;d+=Math.abs(ioi-ideal)}return c01(1-d/k/ideal)}
function semi(deg,G){const o=Math.floor(deg/7),i=((deg%7)+7)%7;return G.scale[i]+12*o}
function chordDegs(root,G){const d=[root,root+2,root+4];if(G.ext>=4)d.push(root+6);if(G.ext>=5&&semi(root+8,G)-semi(root,G)===14)d.push(root+8);return d}
function voicing(root,inv,G){const n=chordDegs(root,G).map(d=>G.chordTonic+semi(d,G));for(let k=0;k<inv;k++)n[k%n.length]+=12;const mean=n.reduce((a,b)=>a+b,0)/n.length,sh=Math.round((62-mean)/12)*12;return n.map(x=>x+sh).sort((a,b)=>a-b)}
function vlDist(A,B){let s=0;for(const a of A){let m=99;for(const b of B)m=Math.min(m,Math.abs(a-b));s+=m}for(const b of B){let m=99;for(const a of A)m=Math.min(m,Math.abs(a-b));s+=m}return s/(A.length+B.length)}
function bassMidi(rd,idx,G){let m=G.low+G.scale[rd];if(m>=40)m-=12;return m+semi(rd+BOFF[idx],G)-semi(rd,G)}
// arpeggio note: idx walks up the chord tones over two octaves
function arpNote(root,idx,G){const o=chordDegs(root,G).map(d=>semi(d,G)-semi(root,G)).filter(x=>x<12).sort((a,b)=>a-b),m=o.length;let b=G.chordTonic+12+semi(root,G);if(b>72)b-=12;return b+o[idx%m]+12*Math.floor(idx/m)}
function chordInfo(root,G){const t=semi(root+2,G)-semi(root,G),f=semi(root+4,G)-semi(root,G),sv=semi(root+6,G)-semi(root,G),minor=t===3,dim=f===6,n=chordDegs(root,G).length;
  const RN=['I','II','III','IV','V','VI','VII'][root];let rom=(G.scale[root]<MAJ[root]?'♭':'')+(minor?RN.toLowerCase():RN)+(dim?'°':'');
  let name=NOTE[(G.pc+G.scale[root])%12]+(minor?'m':'');
  if(n===4){name+=sv===11?'maj7':'7';rom+='7'}else if(n>=5){name+=sv===11?'maj9':'9';rom+='9'}
  return{rom,name}}

// ---- instrument library ----
// Drum parts. ['o',wave,startHz,endHz,sweepSec,decaySec,gain,tuned,delaySec] is a tone with a pitch drop.
// ['n',filter,Hz,Q,decaySec,gain,attackSec,0,delaySec] is filtered noise. ['m',bandHz,highpassHz,decaySec,gain] is a metallic hat.
// ['c',Hz,decaySec,gain] is a burst of claps. In kicks, tuned parts are multiples of the kick note, which follows the key.
const K9=[['o','sine',3.6,1,.07,.3,1,1],['o','triangle',8,2,.028,.07,.45,1],['n','highpass',3000,.7,.012,.2]];
const KIT={
 kick:{
  '909':{p:K9},
  '808':{p:[['o','sine',2.2,1,.05,.6,1,1],['n','highpass',2500,.7,.008,.1]]},
  'House':{p:[['o','sine',3,1,.09,.36,1,1],['o','triangle',5,2,.03,.06,.3,1],['n','lowpass',1200,.7,.02,.12]]},
  'Punch':{p:[['o','sine',4.5,1,.05,.24,1,1],['o','triangle',10,2,.02,.05,.5,1],['n','highpass',4000,.7,.008,.25]]},
  'Hard':{drv:1,p:[['o','sine',5,1.05,.09,.34,1.3,1],['o','square',6,1,.05,.1,.25,1],['n','highpass',2500,.7,.015,.3]]},
  'Rumble':{p:K9.concat([['o','sine',1,.95,.2,.26,.5,1,.12]])},
  'Trance':{p:[['o','sine',4,1,.06,.26,1,1],['o','triangle',9,2.5,.02,.05,.5,1],['n','highpass',5000,.7,.01,.3]]},
  'Psy':{p:[['o','sine',6,1,.035,.16,1.1,1],['n','highpass',4000,.7,.006,.2]]},
  'Deep':{p:[['o','sine',2.6,1,.06,.55,1,1],['n','lowpass',900,.7,.02,.12]]},
  'Slam':{drv:1,p:[['o','sine',4.2,1,.06,.3,1,1],['o','triangle',7,2,.02,.06,.5,1],['n','highpass',3500,.7,.01,.28]]},
  'Click':{p:[['o','sine',5.5,1,.03,.18,1,1],['n','bandpass',1800,1.5,.006,.3]]}},
 clap:{
  'Clap 909':{rev:.24,p:[['c',1500,.16,1],['n','highpass',4200,.7,.09,.35,.001,0,.02]]},
  'Clap 808':{rev:.3,p:[['c',1100,.22,1]]},
  'Snare':{rev:.2,p:[['o','triangle',260,185,.04,.09,.8,1],['n','highpass',1400,.7,.13,1]]},
  'Rim':{rev:.15,p:[['o','triangle',1700,1650,.01,.03,.9],['o','square',480,470,.01,.025,.4],['n','highpass',3000,.7,.02,.3]]},
  'Snap':{rev:.25,p:[['n','bandpass',2300,3,.05,1.4],['n','bandpass',2500,3,.06,1,.001,0,.013]]},
  'Layered':{rev:.28,p:[['c',1500,.16,.8],['o','triangle',240,180,.04,.09,.6,1],['n','highpass',2000,.7,.11,.5]]},
  'Clap Deep':{rev:.3,p:[['c',900,.2,1],['o','triangle',220,190,.03,.06,.4,1]]},
  'Brush':{rev:.2,p:[['n','bandpass',3200,1.2,.16,1.1,.01]]}},
 hat:{
  '909':{p:[['m',10000,8000,.045,1]]},
  '808':{p:[['m',7500,6500,.035,.9]]},
  'Shaker':{p:[['n','bandpass',6500,1.5,.06,1.1,.012]]},
  'Tight':{p:[['n','highpass',9500,.7,.022,1.2]]},
  'Tambourine':{p:[['m',9000,7000,.07,.6],['n','bandpass',8500,2,.05,.6,.004]]},
  'Crisp':{p:[['m',12000,9500,.03,1.1]]},
  'Metal':{p:[['m',6500,5000,.05,.9],['n','highpass',9000,.7,.03,.5]]}},
 ohat:{
  '909':{p:[['m',8500,6800,.24,1]]},
  '808':{p:[['m',7000,5800,.3,.9]]},
  'Sizzle':{p:[['n','highpass',7000,.7,.2,1,.005]]},
  'Ride':{p:[['m',6500,4500,.3,1]]},
  'Long 909':{p:[['m',8600,6600,.36,1]]},
  'Trance Open':{p:[['n','highpass',6500,.7,.26,1,.004]]}},
 perc:{   // three drums per kit: low, middle, high
  'Congas':{rev:.16,p3:[[['o','sine',260,200,.03,.16,1]],[['o','sine',330,270,.03,.13,1]],[['o','sine',420,350,.02,.1,1],['n','bandpass',2500,2,.02,.25]]]},
  'Bongos':{rev:.16,p3:[[['o','sine',400,340,.02,.09,1]],[['o','sine',520,450,.02,.08,1]],[['o','triangle',700,640,.015,.06,.8],['n','bandpass',3000,2,.015,.2]]]},
  'Toms':{rev:.2,p3:[[['o','sine',160,90,.08,.26,1]],[['o','sine',220,130,.07,.22,1]],[['o','sine',300,190,.06,.18,1]]]},
  '808 kit':{rev:.14,p3:[[['o','square',540,540,.01,.12,.4],['o','square',800,800,.01,.12,.4]],[['o','triangle',1700,1650,.01,.03,.9],['n','highpass',3000,.7,.02,.3]],[['o','sine',2500,2500,.01,.05,.9]]]},
  'Shakers':{rev:.1,p3:[[['n','bandpass',5000,1.5,.07,1,.012]],[['m',9000,7000,.07,.6],['n','bandpass',8500,2,.05,.5,.004]],[['n','highpass',9000,.7,.03,1]]]},
  'Zaps':{rev:.2,p3:[[['o','sawtooth',1800,120,.09,.1,.5]],[['o','square',2600,200,.07,.08,.4]],[['o','sine',4000,400,.05,.07,.8]]]},
  'Woodblocks':{rev:.18,p3:[[['o','sine',800,780,.01,.045,1],['n','bandpass',1600,3,.008,.2]],[['o','sine',1050,1020,.01,.04,1],['n','bandpass',2100,3,.008,.2]],[['o','sine',1400,1350,.01,.035,1],['n','bandpass',2800,3,.008,.2]]]},
  'Clicks':{rev:.22,p3:[[['n','bandpass',3000,6,.012,2]],[['n','bandpass',5000,6,.01,2]],[['n','highpass',8000,.7,.008,1.5]]]},
  'Tabla':{rev:.2,p3:[[['o','sine',180,95,.12,.3,1]],[['o','sine',420,400,.02,.12,.9],['n','bandpass',1800,3,.01,.2]],[['o','sine',700,690,.01,.08,.8],['n','bandpass',3200,4,.01,.2]]]},
  'Cajon':{rev:.18,p3:[[['o','triangle',120,80,.03,.14,1]],[['n','bandpass',1200,2,.04,.8,.002]],[['o','triangle',320,300,.01,.05,.8],['n','bandpass',2400,3,.02,.3]]]},
  'Cowbell':{rev:.2,p3:[[['o','square',540,540,.01,.14,.35],['o','square',800,800,.01,.14,.35]],[['o','square',700,700,.01,.12,.3],['o','square',1050,1050,.01,.12,.3]],[['o','square',880,880,.01,.1,.3],['o','square',1320,1320,.01,.1,.3]]]},
  'Blocks':{rev:.16,p3:[[['o','sine',620,600,.01,.05,1]],[['o','sine',880,860,.01,.045,1],['n','bandpass',1800,3,.008,.2]],[['o','sine',1240,1200,.01,.04,1],['n','bandpass',2600,3,.008,.2]]]},
  'Shaker Bell':{rev:.22,p3:[[['n','bandpass',4800,1.6,.06,1,.01]],[['m',9500,7500,.06,.5]],[['o','sine',2100,2100,.01,.12,.5],['n','bandpass',4000,4,.02,.2]]]}}};
// Synth patches. o: oscillators [wave,cents,octave,level]. f: filter [type,baseHz,envelopeMultiple,envelopeSec,Q,keyTracked].
// a,d,s,r: attack, decay, sustain level, release (s = 0 means a pluck of length d). fm: [ratio,index,decaySec,floor].
// fmt: vowel formants [Hz,Q,level]. air: tuned noise [multiple,Q]. w: stereo width. dly, rev: sends. drv: distortion out level.
// vib: [Hz,cents]. sw: how far the filter opens over 8 bars. hold: the note lasts until the next one. len: share of the gap a chord fills.
const SAW7=[-24,-14,-6,0,6,14,24].map(c=>['sawtooth',c,0,.36]),SAW5=[-18,-8,0,8,18].map(c=>['sawtooth',c,0,.42]),AH=[[750,7,1],[1150,8,.7],[2800,9,.3]],OH=[[450,7,1],[800,8,.6],[2830,9,.25]],EE=[[300,7,1],[2300,9,.5],[3000,9,.3]];
const SYN={
 bass:{
  'Sub':{o:[['sine',0,0,1],['triangle',0,0,.25]],a:.006,d:.25,s:.8,r:.03},
  'Square':{o:[['square',0,0,.6],['sine',0,0,.6]],f:['lowpass',700,3,.14,2],d:.2,s:.7,r:.02},
  'Saw':{o:[['sawtooth',0,0,.6],['sawtooth',9,0,.3],['sine',0,0,.6]],f:['lowpass',800,3,.14,3],d:.2,s:.7,r:.02},
  'Acid':{o:[['sawtooth',0,0,.8]],f:['lowpass',420,6,.12,12],d:.16,s:.5,r:.02,drv:.5,g:2,sw:2.5},
  'Reese':{o:[['sawtooth',-22,0,.5],['sawtooth',22,0,.5],['sine',0,0,.5]],f:['lowpass',520,1.5,.3,1.5],a:.01,d:.3,s:.9,r:.04},
  'Organ':{o:[['organ',0,0,.9]],f:['lowpass',1800,1,0,.7],a:.003,d:.12,s:.75,r:.03},
  'FM':{o:[['sine',0,0,1]],fm:[1,2.2,.18,.15],d:.3,s:.6,r:.03},
  'Pluck':{o:[['sawtooth',0,0,.7],['square',0,-1,.3]],f:['lowpass',500,7,.07,3],d:.22,s:0},
  'Psy':{o:[['sawtooth',0,0,.9]],f:['lowpass',380,9,.045,4],d:.1,s:0},
  'Rubber':{o:[['sawtooth',0,0,.7],['sine',0,0,.6]],f:['lowpass',600,5,.1,6],d:.18,s:.4,r:.03,sw:2},
  'Dist':{o:[['sawtooth',-6,0,.6],['sawtooth',6,0,.6]],f:['lowpass',700,3,.12,3],d:.2,s:.55,r:.03,drv:.6,g:1.6},
  'Octave':{o:[['sawtooth',0,0,.6],['square',0,1,.3],['sine',0,-1,.5]],f:['lowpass',900,3,.12,2],d:.2,s:.6,r:.03}},
 chords:{
  'Piano':{o:[['sawtooth',-4,0,.5],['sawtooth',4,0,.5],['square',0,1,.12]],f:['lowpass',2.2,5,.18,1,1],a:.003,d:.8,s:0,rev:.25,w:.3},
  'Organ':{o:[['organ',0,0,1]],f:['lowpass',3000,1,0,.7],a:.003,d:.25,s:.8,r:.04,len:.45,rev:.2},
  'Rhodes':{o:[['sine',0,0,1],['sine',6,0,.5]],fm:[1,1.6,.35,.12],a:.004,d:1.1,s:0,rev:.3,w:.4},
  'Supersaw':{o:SAW5,f:['lowpass',2600,2.2,.12,1],a:.004,d:.3,s:0,w:.9,rev:.3,dly:.2,sw:.6},
  'Dub':{o:[['sawtooth',-8,0,.5],['sawtooth',8,0,.5]],f:['lowpass',700,2.5,.25,5],a:.006,d:.5,s:0,dly:.75,rev:.4,sw:1.5},
  'Pluck':{o:[['sawtooth',-6,0,.5],['sawtooth',6,0,.5]],f:['lowpass',600,6,.07,2],d:.25,s:0,dly:.3,rev:.25,w:.5},
  'Stab':{o:[['sawtooth',-10,0,.5],['sawtooth',10,0,.5],['square',0,0,.3]],f:['lowpass',900,4,.2,2],a:.01,d:.35,s:0,rev:.3,w:.6},
  'Wurli':{o:[['sine',0,0,1],['sine',5,0,.4]],fm:[1,.9,.25,.1],a:.004,d:.7,s:.15,r:.15,rev:.28,w:.4},
  'Glass Keys':{o:[['sine',0,1,.6],['sine',7,0,.4]],fm:[2,.7,.3,.2],a:.005,d:.9,s:0,rev:.35,dly:.2,w:.5},
  'Choir Stab':{o:[['sawtooth',-8,0,.5],['sawtooth',8,0,.5]],fmt:[[650,6,1],[1150,8,.7],[2800,9,.3]],a:.02,d:.4,s:.3,rev:.3,w:.7,g:1.4,len:.5}},
 pad:{
  'Strings':{o:SAW7,f:['lowpass',1500,1,0,.7],a:.25,d:.5,s:.85,r:.35,w:1,rev:.4,sw:1.2},
  'Warm':{o:[['triangle',-7,0,.7],['sawtooth',7,0,.35],['sine',0,-1,.4]],f:['lowpass',900,1,0,.8],a:.3,d:.5,s:.9,r:.4,w:.7,rev:.35},
  'Choir':{o:[['sawtooth',-9,0,.5],['sawtooth',9,0,.5]],fmt:[[650,6,1],[1100,7,.7],[2700,8,.3]],a:.2,d:.4,s:.9,r:.3,w:.8,rev:.45,g:1.6},
  'Glass':{o:[['sine',0,0,.8],['sine',4,1,.3]],fm:[2,.8,.6,.4],a:.15,d:.6,s:.7,r:.5,w:.5,rev:.5,dly:.2},
  'Drone':{low:1,o:[['sawtooth',-12,0,.5],['sawtooth',12,0,.5],['square',0,-1,.3]],f:['lowpass',320,1,0,3],a:.4,d:.5,s:.9,r:.4,sw:2,rev:.3},
  'Noise':{o:[],air:[4,14],a:.4,d:.5,s:.9,r:.5,rev:.5,g:5},
  'Cinematic':{o:SAW7,f:['lowpass',1200,1.4,0,.8],a:.5,d:.6,s:.9,r:.6,w:1,rev:.55,sw:1.6},
  'Vox Pad':{o:[['sawtooth',-10,0,.5],['sawtooth',10,0,.5]],fmt:[[400,7,1],[900,8,.6],[2600,9,.25]],a:.35,d:.5,s:.9,r:.45,w:.9,rev:.5,g:1.5}},
 arp:{
  'Pluck':{o:[['sawtooth',0,0,.6],['square',0,0,.3]],f:['lowpass',900,5,.06,2],d:.16,s:0,dly:.4,rev:.2},
  'Bell':{o:[['sine',0,0,1]],fm:[3.5,2.2,.3,.05],d:.5,s:0,dly:.35,rev:.4},
  'Marimba':{o:[['sine',0,0,1]],fm:[4,1.6,.07,0],d:.3,s:0,rev:.25,dly:.2},
  'Pizzicato':{o:[['sawtooth',-5,0,.5],['sawtooth',5,0,.5]],f:['lowpass',1,6,.03,1,1],d:.14,s:0,rev:.35,w:.4},
  'Blip':{o:[['square',0,0,.8]],f:['lowpass',3800,1,0,1],d:.1,s:0,dly:.35},
  'Acid':{o:[['sawtooth',0,0,.8]],f:['lowpass',600,5,.08,12],d:.12,s:0,drv:.3,g:2.2,sw:3,dly:.2},
  'Glass':{o:[['sine',0,1,.8]],fm:[2,1,.2,.1],d:.3,s:0,dly:.45,rev:.4},
  'Koto':{o:[['triangle',0,0,.9],['sawtooth',4,0,.25]],f:['lowpass',1500,4,.05,4],d:.2,s:0,rev:.25,dly:.25},
  'Harp':{o:[['sine',0,0,.9],['triangle',3,1,.3]],d:.45,s:0,rev:.4,dly:.3}},
 lead:{
  'Pluck':{o:[['sawtooth',-7,0,.5],['sawtooth',7,0,.5]],f:['lowpass',900,5.8,.13,3],d:.28,s:0,dly:.38,rev:.22,w:.6},
  'Saw':{o:[['sawtooth',-8,0,.5],['sawtooth',8,0,.5]],f:['lowpass',2400,1.8,.2,1.5],a:.01,d:.3,s:.7,r:.08,vib:[5.5,7],hold:1,dly:.3,rev:.25,w:.5},
  'Square':{o:[['square',0,0,.5],['square',5,0,.3]],f:['lowpass',1800,2.5,.1,2],d:.2,s:.5,r:.05,hold:1,dly:.3,rev:.15},
  'Fuzz':{o:[['sawtooth',-9,0,.5],['sawtooth',0,0,.5],['sawtooth',9,0,.5]],f:['lowpass',500,2.6,.08,7],d:.2,s:0,drv:.3,g:2.5,sw:5.2,dly:.12,rev:.14},
  'Supersaw':{o:SAW7,f:['lowpass',3200,1.6,.2,1],a:.008,d:.4,s:.75,r:.12,hold:1,w:1,dly:.3,rev:.35},
  'Bell':{o:[['sine',0,0,1]],fm:[3.5,2.2,.5,.05],d:.9,s:0,dly:.35,rev:.4},
  'Whistle':{o:[['sine',0,0,1]],a:.03,d:.3,s:.85,r:.1,vib:[5,12],hold:1,dly:.3,rev:.4},
  'Vox':{o:[['sawtooth',-6,0,.5],['sawtooth',6,0,.5]],fmts:[AH,OH,EE],a:.01,d:.18,s:.6,r:.06,hold:1,dly:.35,rev:.3},
  'Marimba':{o:[['sine',0,0,1]],fm:[4,1.6,.07,0],d:.35,s:0,rev:.25,dly:.2},
  'Acid':{o:[['square',0,0,.7]],f:['lowpass',500,6,.1,13],d:.18,s:.4,r:.03,hold:1,drv:.3,g:2.2,sw:4,dly:.25},
  'Saw Stack':{o:[['sawtooth',-12,0,.4],['sawtooth',0,0,.5],['sawtooth',12,0,.4]],f:['lowpass',2800,2,.15,1.6],a:.006,d:.35,s:.7,r:.09,vib:[5,6],hold:1,w:1,dly:.3,rev:.3},
  'Flute':{o:[['sine',0,0,1],['triangle',0,1,.15]],a:.04,d:.25,s:.85,r:.1,vib:[5.5,10],hold:1,rev:.35,dly:.25},
  'Theremin':{o:[['sine',0,0,1]],a:.08,d:.3,s:.9,r:.2,vib:[6,18],hold:1,rev:.45,dly:.3}}};
const LIB=id=>KIT[id]||SYN[id];

// ---- styles ----
const DEF={plan:'house',swing:[0,.05],modes:['natural minor'],ext:[3,4],variety:[2,3],kickX:[0,1],clapX:[0,1],hatN:[6,10],ohN:[2,4],percN:[3,6],percSync:[3,7],bassN:[5,8],bassSync:[5,9],chordN:[2,4],chordSync:[4,8],leadN:[4,8],leadSync:[3,7],padSeg:[1],arpN:[6,10],arpPer:[3,4,8],accent:['off']};
const STYLES=[
{fam:'House',name:'Deep house',sig:'Electric piano chords, a sub bass and congas.',bpm:[120,124],swing:[.08,.16],modes:['Dorian','natural minor'],ext:[4,5],variety:[2,4],kickX:[0,0],percN:[3,5],percSync:[3,6],bassN:[4,6],bassSync:[5,8],leadN:[4,7],padSeg:[1,2],arpN:[4,8],
 inst:{kick:['House','808','Deep'],clap:['Clap 909','Snap','Rim'],hat:['909','Shaker'],ohat:['909','Sizzle'],perc:['Congas','Bongos','Shakers','Cajon'],bass:['Sub','Organ','FM'],chords:['Rhodes','Organ','Dub','Wurli'],pad:['Warm','Choir','Glass'],arp:['Marimba','Bell','Pluck'],lead:['Pluck','Marimba','Whistle','Vox','Flute']}},
{fam:'House',name:'Classic house',sig:'Piano stabs, an organ bass and 909 drums, in a major key.',bpm:[122,126],swing:[.1,.18],modes:['major','Mixolydian','Dorian'],variety:[2,4],chordN:[3,5],chordSync:[5,9],leadN:[3,6],leadSync:[4,8],arpN:[4,8],
 inst:{kick:['909','House'],clap:['Clap 909','Clap 808'],hat:['909','808','Tambourine'],ohat:['909','808'],perc:['808 kit','Congas','Shakers'],bass:['Organ','FM','Sub'],chords:['Piano','Organ','Wurli'],pad:['Strings','Choir'],arp:['Pluck','Bell'],lead:['Vox','Whistle','Square','Flute']}},
{fam:'House',name:'Tech house',sig:'Busy percussion, a bouncing bass and short stabs.',bpm:[124,128],swing:[.05,.12],modes:['natural minor','Dorian','Phrygian'],variety:[1,2],clapX:[0,2],hatN:[8,12],percN:[5,7],percSync:[4,8],bassN:[6,9],chordN:[2,3],leadN:[3,6],leadSync:[4,8],accent:['off','on'],
 inst:{kick:['909','Punch','House'],clap:['Clap 909','Snare','Rim'],hat:['909','Shaker','Tight','Crisp'],ohat:['909','Sizzle'],perc:['Toms','Congas','Zaps','Woodblocks','Cowbell','Blocks'],bass:['Saw','Square','Pluck','FM'],chords:['Stab','Pluck','Organ'],pad:['Drone','Warm'],arp:['Blip','Pluck'],lead:['Vox','Square','Pluck']}},
{fam:'House',name:'Acid house',sig:'A squelching 303-style bass line over 808 and 909 drums.',bpm:[120,126],swing:[.04,.12],modes:['natural minor','Phrygian'],ext:[3,3],variety:[1,2],bassN:[9,12],bassSync:[7,11],chordN:[1,3],leadN:[2,5],arpN:[4,8],
 inst:{kick:['909','808'],clap:['Clap 909','Clap 808'],hat:['909','808'],ohat:['909','808'],perc:['808 kit','Toms','Cowbell'],bass:['Acid','Rubber'],chords:['Organ','Stab','Piano'],pad:['Warm','Drone'],arp:['Blip','Acid'],lead:['Square','Vox','Bell']}},
{fam:'House',name:'Progressive house',sig:'Long pads, a plucked arpeggio and a slow build.',bpm:[122,128],modes:['natural minor','Dorian','major'],ext:[4,4],variety:[3,4],kickX:[0,0],bassN:[6,10],bassSync:[6,10],leadN:[5,9],arpN:[8,14],
 inst:{kick:['Punch','House','Deep'],clap:['Clap 909','Layered'],hat:['Tight','Shaker'],ohat:['909','Sizzle'],perc:['Shakers','Congas','Tabla'],bass:['Pluck','Saw','Sub'],chords:['Pluck','Supersaw','Rhodes'],pad:['Strings','Warm','Glass','Choir','Cinematic'],arp:['Pluck','Bell','Glass'],lead:['Saw','Pluck','Bell','Whistle','Saw Stack']}},
{fam:'Techno',name:'Minimal techno',sig:'Few sounds, small clicks and a lot of space.',plan:'techno',bpm:[124,130],swing:[0,.1],modes:['natural minor','Phrygian'],ext:[3,3],variety:[1,2],hatN:[4,8],ohN:[1,3],percN:[4,7],percSync:[4,8],bassN:[3,6],bassSync:[4,8],chordN:[1,2],chordSync:[3,7],leadN:[2,5],arpN:[3,6],
 inst:{kick:['Punch','808'],clap:['Rim','Snap','Clap 808'],hat:['Tight','808','Metal'],ohat:['Sizzle','808','Trance Open'],perc:['Woodblocks','Zaps','Clicks','808 kit','Cajon'],bass:['Sub','Pluck','FM'],chords:['Dub','Pluck'],pad:['Drone','Noise'],arp:['Blip','Glass'],lead:['Pluck','Bell','Square']}},
{fam:'Techno',name:'Peak-time techno',sig:'A rumbling kick, a rolling bass and dark stabs.',plan:'techno',bpm:[130,136],swing:[0,.03],modes:['Phrygian','natural minor'],ext:[3,3],variety:[1,2],kickX:[0,2],hatN:[4,8],ohN:[4,4],bassN:[10,12],bassSync:[9,11],chordN:[1,3],chordSync:[3,7],leadN:[5,9],leadSync:[4,8],accent:['off','on'],
 inst:{kick:['Rumble','909','Hard','Slam'],clap:['Clap 909','Snare','Layered'],hat:['909','Tight'],ohat:['909','Ride'],perc:['Toms','Zaps','Clicks'],bass:['Saw','Reese','Sub'],chords:['Stab','Dub'],pad:['Drone','Noise','Strings','Cinematic'],arp:['Acid','Blip'],lead:['Saw','Square','Acid','Bell']}},
{fam:'Techno',name:'Hard techno',sig:'Very fast, with a distorted kick and rave stabs.',plan:'techno',bpm:[142,150],swing:[0,0],modes:['Phrygian','natural minor','harmonic minor'],ext:[3,3],variety:[1,2],ohN:[4,4],percN:[2,5],bassN:[10,12],bassSync:[9,11],chordN:[1,2],leadN:[3,6],arpN:[6,12],
 inst:{kick:['Hard','Rumble','Slam'],clap:['Snare','Layered','Clap 909'],hat:['909','Tight'],ohat:['Ride','909'],perc:['Toms','Zaps'],bass:['Reese','Saw'],chords:['Stab','Supersaw'],pad:['Drone','Noise'],arp:['Acid','Blip'],lead:['Acid','Square','Saw']}},
{fam:'Techno',name:'Dub techno',sig:'Echoing minor chords over a deep sub bass.',plan:'techno',bpm:[118,126],swing:[0,.08],modes:['natural minor','Dorian'],ext:[4,5],variety:[1,2],kickX:[0,0],hatN:[4,8],ohN:[1,3],percN:[3,5],bassN:[3,5],bassSync:[4,8],chordSync:[5,9],leadN:[2,4],arpN:[3,6],
 inst:{kick:['House','808','Punch'],clap:['Rim','Snap'],hat:['Tight','Shaker','Crisp'],ohat:['Sizzle','Long 909'],perc:['Clicks','Shakers','Woodblocks'],bass:['Sub'],chords:['Dub'],pad:['Noise','Warm','Drone'],arp:['Glass','Bell'],lead:['Bell','Pluck','Whistle']}},
{fam:'Techno',name:'Melodic techno',sig:'A long melody over plucked chords and wide pads.',plan:'techno',bpm:[122,126],swing:[0,.06],modes:['natural minor','Dorian'],ext:[4,4],variety:[3,4],percN:[3,5],percSync:[3,6],bassN:[6,10],bassSync:[6,10],chordN:[1,3],chordSync:[2,6],leadN:[8,12],
 inst:{kick:['Punch','Rumble'],clap:['Clap 909','Layered'],hat:['Tight','Shaker','909'],ohat:['909','Sizzle'],perc:['Shakers','Toms','Tabla'],bass:['Saw','Reese','Pluck'],chords:['Pluck','Supersaw'],pad:['Strings','Choir','Glass','Warm','Vox Pad'],arp:['Pluck','Bell','Glass','Pizzicato','Koto'],lead:['Saw','Bell','Pluck','Whistle','Saw Stack']}},
{fam:'Trance',name:'Classic trance',sig:'A distorted sixteenth-note riff, an off-beat bass and snare-roll builds.',plan:'trance',bpm:[136,136],swing:[0,0],ext:[3,3],variety:[2,4],kickX:[0,0],clapX:[0,0],hatN:[8,14],ohN:[4,4],percN:[2,4],percSync:[3,6],bassModes:[[4,7,'off'],[12,10.5,'roll']],chordN:[6,10],chordSync:[2,6],leadN:[14,16],leadSync:[0,3],arpN:[10,16],arpPer:[3],riff:true,pump:1,
 inst:{kick:['Trance','909'],clap:['Clap 909','Layered'],hat:['909'],ohat:['909','Long 909'],perc:['Shakers','808 kit'],bass:['Square','Saw'],chords:['Supersaw','Pluck'],pad:['Strings','Choir','Cinematic'],arp:['Blip','Pizzicato','Pluck','Harp'],lead:['Fuzz','Saw Stack']}},
{fam:'Trance',name:'Uplifting trance',sig:'Wide supersaw chords, a rolling bass and a soaring lead.',plan:'trance',bpm:[136,140],swing:[0,0],ext:[3,3],variety:[4,4],kickX:[0,0],clapX:[0,0],hatN:[8,12],ohN:[4,4],percN:[2,4],bassModes:[[12,10.5,'roll'],[4,7,'off']],chordN:[6,10],chordSync:[2,6],leadN:[3,6],leadSync:[1,5],padSeg:[1,8],arpN:[12,16],arpPer:[3,4],pump:1,
 inst:{kick:['Trance','Punch'],clap:['Clap 909','Layered','Snare'],hat:['909','Tight'],ohat:['909'],perc:['Shakers'],bass:['Saw','Square','Pluck'],chords:['Supersaw'],pad:['Strings','Choir','Vox Pad'],arp:['Pluck','Pizzicato','Bell'],lead:['Supersaw','Saw','Whistle','Saw Stack','Theremin']}},
{fam:'Trance',name:'Progressive trance',sig:'A steady groove, plucked melodies and long filter sweeps.',plan:'trance',bpm:[128,134],swing:[0,.03],modes:['natural minor','Dorian'],ext:[4,4],variety:[2,4],kickX:[0,0],percN:[3,5],bassModes:[[4,7,'off'],[12,10.5,'roll']],leadN:[6,10],padSeg:[1,2],arpN:[8,14],pump:1,
 inst:{kick:['Punch','Trance'],clap:['Clap 909','Layered'],hat:['Tight','Shaker','909'],ohat:['909','Sizzle'],perc:['Shakers','Tabla','Congas'],bass:['Pluck','Saw','Sub'],chords:['Pluck','Supersaw'],pad:['Strings','Glass','Warm'],arp:['Pluck','Glass','Bell','Koto'],lead:['Pluck','Saw','Bell','Flute']}},
{fam:'Trance',name:'Psytrance',sig:'Very fast, with a galloping one-note bass and squelchy leads.',plan:'trance',bpm:[140,146],swing:[0,0],modes:['Phrygian','harmonic minor'],ext:[3,3],variety:[1,1],kickX:[0,0],clapX:[0,0],ohN:[4,4],bassModes:[[12,10.5,'roll']],root:[.95,1],chordN:[1,2],leadN:[10,16],leadSync:[0,4],riff:true,leadStep:.9,arpN:[8,14],arpPer:[3,4],
 inst:{kick:['Psy'],clap:['Snare','Clap 909'],hat:['Tight','909','Metal'],ohat:['909'],perc:['Zaps','Tabla','Toms','Blocks'],bass:['Psy'],chords:['Stab'],pad:['Drone','Noise'],arp:['Acid','Blip','Glass'],lead:['Acid','Square','Saw Stack']}}
].map(s=>Object.assign({},DEF,s));

function makeGenome(seed,want,brief){
  const r=rngFrom(seed*7919+13),u=r(),fam=want&&want.indexOf('fam:')===0?want.slice(4):'',pool=fam?STYLES.filter(x=>x.fam===fam):STYLES,st=STYLES.find(x=>x.name===want)||pool[Math.floor(u*pool.length)];
  const mode=pick(r,st.modes),pc=ri(r,0,11),R=k=>ri(r,st[k][0],st[k][1]);
  const G={seed,style:st.name,fam:st.fam,plan:st.plan,mode,scale:SCALES[mode],pc,bad:BAD[mode],bpm:R('bpm'),swing:rf(r,st.swing[0],st.swing[1]),ext:R('ext'),variety:R('variety'),
    kickX:R('kickX'),clapX:R('clapX'),hatN:R('hatN'),ohN:R('ohN'),percN:R('percN'),percSync:R('percSync'),bassN:R('bassN'),bassSync:R('bassSync'),chordN:R('chordN'),chordSync:R('chordSync'),leadN:R('leadN'),leadSync:R('leadSync'),
    padSeg:pick(r,st.padSeg),padCover:rf(r,.7,1),arpN:R('arpN'),arpPer:pick(r,st.arpPer),arpDir:pick(r,['up','down','updown','free']),
    bassRootShare:st.root?rf(r,st.root[0],st.root[1]):rf(r,.6,.9),taste:[0,1,2,3,4,5,6].map(()=>rf(r,.4,1)),move:[.4,.8,.7,1,.85,.85,.9].map(v=>v*rf(r,.7,1)),
    hatAccent:pick(r,st.accent),percMain:ri(r,1,3),percShare:rf(r,.35,.6),crowd:5,lateLead:r()<.5,fillKind:ri(r,0,1),percPan:(r()<.5?-1:1)*rf(r,.2,.45),duck:rf(r,.25,.5),
    feel:{hat:rf(r,.004,.012),clap:rf(r,-.008,-.002),perc:rf(r,0,.01),bass:rf(r,0,.006)},inst:{},br:{}};
  IDS.forEach(id=>{G.inst[id]=pick(r,st.inst[id]);G.br[id]=rf(r,.8,1.3)});
  if(mode==='Phrygian')G.ext=Math.min(4,G.ext);if(mode==='harmonic minor')G.ext=3;
  G.riff=!!st.riff;G.leadStep=st.leadStep||(st.riff?.45:1.5);
  if(st.bassModes){const m=pick(r,st.bassModes);G.bassN=m[0];G.bassSync=m[1];G.bassShape=m[2]}
  if(st.pump)G.duck*=.75;
  G.taste[0]=1;G.bad.forEach(d=>{G.taste[d]=0});G.allowed=[0,1,2,3,4,5,6].filter(d=>G.bad.indexOf(d)<0);
  G.low=28+((pc-4+12)%12);G.kickHz=mtof(G.low);G.chordTonic=48+pc;G.leadBase=pc<=5?60+pc:48+pc;
  G.bassGate=G.bassN>=10?.9:rf(r,1,2);
  G.keyName=NOTE[pc]+' '+(mode==='natural minor'?'minor':mode);
  return brief?tuneGenome(G,brief):G}

// A brief (from Jev, js/jev.js) pins some of what the seed would otherwise choose: tempo, key, mode,
// swing and instruments. Anything it leaves out stays as the seed rolled it. The key and mode feed
// several derived fields, so those are recomputed here exactly as makeGenome() builds them.
function tuneGenome(G,b){
  if(b.mode&&SCALES[b.mode]){G.mode=b.mode;G.scale=SCALES[b.mode];G.bad=BAD[b.mode]}
  if(Number.isInteger(b.key))G.pc=((b.key%12)+12)%12;
  if(b.mode||Number.isInteger(b.key)){
    const pc=G.pc,mode=G.mode;
    G.taste=G.taste.map(t=>t||.7);G.taste[0]=1;G.bad.forEach(d=>{G.taste[d]=0});
    G.allowed=[0,1,2,3,4,5,6].filter(d=>G.bad.indexOf(d)<0);
    if(mode==='Phrygian')G.ext=Math.min(4,G.ext);if(mode==='harmonic minor')G.ext=3;
    G.low=28+((pc-4+12)%12);G.kickHz=mtof(G.low);G.chordTonic=48+pc;G.leadBase=pc<=5?60+pc:48+pc;
    G.keyName=NOTE[pc]+' '+(mode==='natural minor'?'minor':mode);
  }
  if(Number.isFinite(b.bpm))G.bpm=Math.round(Math.max(80,Math.min(175,b.bpm)));
  if(Number.isFinite(b.swing))G.swing=Math.max(0,Math.min(.3,b.swing));
  if(b.inst)for(const id in b.inst){const nm=b.inst[id];if(LIB(id)&&LIB(id)[nm])G.inst[id]=nm}
  return G}

const randBin=(r,n)=>{const p=Array(16).fill(0);let k=0,g=0;while(k<n&&g++<200){const i=ri(r,0,15);if(!p[i]){p[i]=1;k++}}return p};
const randLvl=(r,n)=>randBin(r,n).map(x=>x?ri(r,1,3):0);
const flip=(p,r)=>{const q=p.slice(),m=r();
  if(m<.5){const i=ri(r,0,15);q[i]=q[i]?0:1}
  else if(m<.85){const on=[];for(let i=0;i<16;i++)if(q[i])on.push(i);if(on.length){const i=pick(r,on),j=(i+(r()<.5?1:15))%16;q[i]=0;q[j]=1}else q[ri(r,0,15)]=1}
  else{const i=ri(r,0,15),j=ri(r,0,15);q[i]=q[i]?0:1;q[j]=q[j]?0:1}
  return q};
const flipL=(p,r)=>{const q=p.slice(),m=r();
  if(m<.5){const i=ri(r,0,15);q[i]=q[i]?0:ri(r,1,3)}
  else if(m<.85){const on=[];for(let i=0;i<16;i++)if(q[i])on.push(i);if(on.length){const i=pick(r,on),j=(i+(r()<.5?1:15))%16;if(!q[j]){q[j]=q[i];q[i]=0}else q[i]=ri(r,1,3)}else q[ri(r,0,15)]=ri(r,1,3)}
  else{for(let k=0;k<2;k++){const i=ri(r,0,15);q[i]=q[i]?0:ri(r,1,3)}}
  return q};
// neighbours: flip one step, or move one hit to any empty step
const binN=p=>{const out=[];for(let i=0;i<16;i++){const q=p.slice();q[i]=q[i]?0:1;out.push(q);if(p[i])for(let j=0;j<16;j++)if(!p[j]){const m=p.slice();m[i]=0;m[j]=1;out.push(m)}}return out};
const lvlN=p=>{const out=[];for(let i=0;i<16;i++){for(let v=0;v<4;v++)if(v!==p[i]){const q=p.slice();q[i]=v;out.push(q)}if(p[i])for(const d of[1,15]){const j=(i+d)%16;if(!p[j]){const m=p.slice();m[j]=p[i];m[i]=0;out.push(m)}}}return out};
const idxN=(p,top)=>{const out=[];for(let i=0;i<16;i++){for(let v=-1;v<=top;v++)if(v!==p[i]){const q=p.slice();q[i]=v;out.push(q)}if(p[i]>=0)for(let j=0;j<16;j++)if(p[j]<0){const m=p.slice();m[j]=p[i];m[i]=-1;out.push(m)}}return out};
// whole-pattern proposals for the arpeggio: one cell in the run's shape, tiled across the bar, with a few rest patterns
function arpSeeds(G){const k=G.arpPer,d=G.arpDir,out=[];
  for(let s0=0;s0<3;s0++){const cell=[];for(let j=0;j<k;j++)cell.push((d==='up'?s0+j:d==='down'?s0+k-1-j:d==='updown'?s0+(j<k/2?j:k-j):s0+(j%2?(j+3)/2:j/2))%6);
    for(const m of[j=>true,j=>j!==k-1,j=>j%2===0,j=>j!==1,j=>j===0,j=>j<=1])out.push(Array.from({length:16},(x,i)=>m(i%k)?cell[i%k]:-1))}
  return out}
// whole-pattern proposals for the pad: one held chord of each length, and even pulses at two widths
const PADSEEDS=(()=>{const out=[];for(let n=8;n<=16;n++)out.push(Array.from({length:16},(x,i)=>i<n?1:0));
  for(const k of[2,4,8])for(const d of[.5,.75])out.push(Array.from({length:16},(x,i)=>(i%(16/k))<Math.max(1,Math.round(16/k*d))?1:0));return out})();
const plural=(n,w)=>n+' '+w+(n===1?'':'s');
const SYNC_WHY='Some notes land on weak steps and skip strong ones. A medium amount gives the strongest wish to move.';

// ---- rules that look across layers (second pass) ----
function velAt(id,p,s,G){const i=s%16;switch(id){
  case'kick':case'ohat':return p[i]?1:0;
  case'clap':case'hat':return LV[p[i]];
  case'perc':return p[i]?.8:0;
  case'bass':case'arp':return p[i]>=0?1:0;
  case'chords':return p.hit[i]?1:0;
  case'pad':return p[i]?.5:0;
  default:return((p[i]>=0?1:0)+(p[i+16]>=0?1:0))/2}}
function clash(id,p,c){const F=c.F,me=F[id];let tot=0;for(const x of me)tot+=x;if(!tot)return 0;const n=id==='lead'?32:16;let cov=0,w=0;
  for(let s=0;s<n;s++){const v=id==='lead'?(p[s]>=0?1:0):velAt(id,p,s,c.G);if(v<=0)continue;w+=v;
    for(let b=0;b<6;b++){let o=0;for(const k of IDS){if(k===id||!c.pat[k])continue;const u=velAt(k,c.pat[k],s,c.G);if(u>0)o+=u*F[k][b]}cov+=Math.min(v*me[b],o)}}
  return w?cov/(w*tot):0}
function crowdShare(id,p,c){const n=id==='lead'?32:16;let hits=0,bad=0;
  for(let s=0;s<n;s++){const v=id==='lead'?p[s]>=0:velAt(id,p,s,c.G)>0;if(!v)continue;hits++;let o=0;
    for(const k of IDS){if(k===id||k==='pad'||!c.pat[k])continue;if(velAt(k,c.pat[k],s,c.G)>0)o++}if(o>=c.G.crowd)bad++}
  return hits?bad/hits:0}
const MIX={n:'Clear mix',w:2,two:true,src:'plomp',why:'Uses the spectrum measured from the live sound. A hit scores lower when another instrument fills the same frequency band on the same step.',f:(p,c,L)=>1-clash(L.id,p,c)};
const CROWD={n:'Not too crowded',w:2,two:true,why:G=>'A step sounds cluttered when many instruments hit at once. This rule counts hits that land where '+G.crowd+' or more other instruments play.',f:(p,c,L)=>1-crowdShare(L.id,p,c)};
const ANSWER={n:'Answers the chords',w:1.5,two:true,src:'butler',why:'The lead plays in the gaps between chord hits, like a call and a reply.',f:(p,c)=>{let n=0,k=0;for(let s=0;s<32;s++)if(p[s]>=0){n++;if(c.pat.chords.hit[s%16])k++}return n?1-k/n:0}};
const ROOM={n:'Leaves room for the lead',w:1.5,two:true,src:'butler',why:'The arpeggio plays where the lead melody rests.',f:(p,c)=>{const ld=c.pat.lead;if(!ld)return 1;let n=0,k=0;for(let s=0;s<16;s++)if(p[s]>=0){n++;k+=((ld[s]>=0?1:0)+(ld[s+16]>=0?1:0))/2}return n?1-k/n:0}};

const LAYERS=[
{id:'kick',name:'Kick',long:'kick drum',K:6,rounds:2,minBars:2,maxBars:5,
 init:r=>randBin(r,ri(r,3,6)),mutate:(p,r)=>flip(p,r),neigh:p=>binN(p),
 rules:[
  {n:'Four on the floor',w:4,src:'butler',why:'A kick on every beat is the base of house, techno and trance.',f:p=>(p[0]+p[4]+p[8]+p[12])/4},
  {n:'Few extra kicks',w:2,why:G=>'This run allows '+plural(G.kickX,'extra kick')+' per bar. More would crowd the low end.',f:(p,c)=>near(cnt(p)-(p[0]+p[4]+p[8]+p[12]),c.G.kickX,2)},
  {n:'Room to ring',w:1.5,why:'No kick lands right after another kick. Each hit needs room for its low tail.',f:p=>{let k=0,n=0;for(let i=0;i<16;i++)if(p[i]){n++;if(p[(i+15)%16])k++}return n?1-k/n:0}},
  {n:'Extras lead into a beat',w:1,why:'An extra kick sounds best just before a beat, as a pickup.',f:p=>{let e=0,g=0;for(let i=0;i<16;i++)if(p[i]&&i%4){e++;if(i%4>=2)g++}return e?g/e:1}}]},
{id:'clap',name:'Clap',long:'clap or snare',K:6,rounds:2,minBars:2,maxBars:5,
 init:r=>randLvl(r,ri(r,2,4)),mutate:(p,r)=>flipL(p,r),neigh:p=>lvlN(p),
 rules:[
  {n:'Backbeat',w:4,src:'butler',why:'Loud hits on beats 2 and 4 answer the kick on beats 1 and 3.',f:p=>(p[4]+p[12])/6},
  {n:'Off the downbeats',w:2,why:'Beats 1 and 3 stay clear, so the kick and the clap take turns.',f:p=>{const n=cnt(p);return n?1-(has(p,0)+has(p,8))/n:0}},
  {n:'Ghost hits',w:1.5,why:G=>'This run wants '+plural(G.clapX,'quiet extra hit')+' per bar.',f:(p,c)=>near(cnt(p)-has(p,4)-has(p,12),c.G.clapX,2)},
  {n:'Ghosts stay soft',w:1,src:'witek',why:'Extra hits sit on weak sixteenth notes and play softly. That adds light syncopation.',f:p=>{let e=0,g=0;for(let i=0;i<16;i++)if(p[i]&&i!==4&&i!==12){e++;g+=(i%2?.5:0)+(p[i]===1?.5:0)}return e?g/e:1}}]},
{id:'hat',name:'Hats',long:'closed hi-hat',K:8,rounds:2,minBars:3,maxBars:6,
 init:r=>randLvl(r,ri(r,4,9)),mutate:(p,r)=>flipL(p,r),neigh:p=>lvlN(p),
 rules:[
  {n:'Fills the gaps',w:3,src:'butler',why:'Hats on the off-beats sit between the kicks, so the two parts interlock.',f:p=>(has(p,2)+has(p,6)+has(p,10)+has(p,14))/4},
  {n:'Right amount',w:2,why:G=>'This run wants about '+plural(G.hatN,'hat')+' per bar.',f:(p,c)=>near(cnt(p),c.G.hatN,5)},
  {n:'Evenly spread',w:2,src:'toussaint',why:'Hits are spaced as evenly as the grid allows. Many traditional rhythms work this way.',f:p=>evenness(p)},
  {n:'Repeats each half bar',w:1,src:'butler',why:'A short pattern that repeats is easy to lock onto.',f:p=>{let s=0;for(let i=0;i<8;i++)if(has(p,i)===has(p,i+8))s++;return s/8}},
  {n:'Loud and soft',w:2,why:G=>'The loudest hats fall on the '+(G.hatAccent==='on'?'beats':'off-beats')+'. The sixteenth notes between them play softly.',f:(p,c)=>{let n=0,s=0;const on=c.G.hatAccent==='on';for(let i=0;i<16;i++)if(p[i]){n++;const ideal=i%2?1:((i%4===0)===on?3:2);s+=1-Math.abs(p[i]-ideal)/2}return n?s/n:0}}],
 rules2:[MIX,CROWD]},
{id:'ohat',name:'Open hat',long:'open hi-hat',K:6,rounds:2,minBars:2,maxBars:4,
 init:r=>randBin(r,ri(r,1,4)),mutate:(p,r)=>flip(p,r),neigh:p=>binN(p),
 rules:[
  {n:'On the off-beat',w:3,src:'butler',why:'The open hat rings halfway between two kicks. That is the classic house lift.',f:p=>{const n=cnt(p);return n?(p[2]+p[6]+p[10]+p[14])/n:0}},
  {n:'Right amount',w:2,why:G=>'This run wants '+plural(G.ohN,'open hat')+' per bar.',f:(p,c)=>near(cnt(p),c.G.ohN,2)},
  {n:'Clear of kick and clap',w:2,why:'It never lands on a kick or a clap, so each hit stays clear.',f:(p,c)=>{let n=0,k=0;for(let i=0;i<16;i++)if(p[i]){n++;if(c.pat.kick[i]||c.pat.clap[i])k++}return n?1-k/n:0}}]},
{id:'perc',name:'Perc',long:'percussion kit',pitch:true,K:8,rounds:2,minBars:3,maxBars:6,
 init:r=>randLvl(r,ri(r,2,7)),mutate:(p,r)=>flipL(p,r),neigh:p=>lvlN(p),
 rules:[
  {n:'Evenly spread',w:2,src:'toussaint',why:'Hits are spaced as evenly as the grid allows.',f:p=>evenness(p)},
  {n:'Medium syncopation',w:2,src:'witek',why:SYNC_WHY,f:(p,c)=>cnt(p)?near(sync(p),c.G.percSync,4):0},
  {n:'Fills empty space',w:2,src:'butler',why:'Hits go where the kick and the clap are silent.',f:(p,c)=>{let n=0,k=0;for(let i=0;i<16;i++)if(p[i]){n++;if(c.pat.kick[i]||c.pat.clap[i])k++}return n?1-k/n:0}},
  {n:'Right amount',w:1.5,why:G=>'This run wants about '+plural(G.percN,'hit')+' per bar.',f:(p,c)=>near(cnt(p),c.G.percN,2)},
  {n:'Uses the kit',w:1.5,why:G=>'The kit has three drums: low, middle and high. The part moves between them. About '+Math.round(G.percShare*100)+'% of the hits use the '+['low','middle','high'][G.percMain-1]+' drum.',f:(p,c)=>{let n=0,m=0;const u={};for(let i=0;i<16;i++)if(p[i]){n++;u[p[i]]=1;if(p[i]===c.G.percMain)m++}return n?.5*Math.min(1,Object.keys(u).length/Math.min(3,n))+.5*near(m/n,c.G.percShare,.6):0}}],
 rules2:[MIX,CROWD]},
{id:'bass',name:'Bass',long:'bass line',pitch:true,K:8,rounds:2,minBars:3,maxBars:7,
 init:r=>{const p=Array(16).fill(-1),n=ri(r,3,8);for(let k=0;k<n;k++)p[ri(r,0,15)]=r()<.6?0:ri(r,1,3);return p},
 mutate:(p,r)=>{const q=p.slice(),i=ri(r,0,15),m=r();
  if(q[i]<0)q[i]=r()<.6?0:ri(r,1,3);
  else if(m<.45)q[i]=-1;
  else if(m<.75)q[i]=r()<.5?0:ri(r,1,3);
  else{const j=(i+(r()<.5?1:15))%16;if(q[j]<0)q[j]=q[i];q[i]=-1}
  return q},
 neigh:p=>idxN(p,3),
 rules:[
  {n:'Leaves room for the kick',w:3,src:'plomp',why:'Kick and bass share the lowest band. Low sounds that sit close in pitch blur each other, so the bass plays where the kick is silent.',f:(p,c)=>{let n=0,k=0;for(let i=0;i<16;i++)if(p[i]>=0){n++;if(c.pat.kick[i])k++}return n?1-k/n:0}},
  {n:'Root first',w:2.5,src:'krumhansl',why:'The root is the most stable note of a chord. The bass plays it most of the time and adds the fifth or third for colour.',f:(p,c)=>{let n=0,rt=0,first=-1;for(let i=0;i<16;i++)if(p[i]>=0){if(first<0)first=p[i];n++;if(p[i]===0||p[i]===2)rt++}if(!n)return 0;return near(rt/n,c.G.bassRootShare,.4)*((first===0||first===2)?1:.7)}},
  {n:'Right amount',w:2,why:G=>'This run wants about '+plural(G.bassN,'bass note')+' per bar.',f:(p,c)=>near(cnt(bin(p)),c.G.bassN,4)},
  {n:'Push and pull',w:2,src:'witek',why:SYNC_WHY,f:(p,c)=>{const b=bin(p);return cnt(b)?near(sync(b),c.G.bassSync,5):0}}],
 rulesR:[{n:'Bass shape',w:4,why:G=>G.bassShape==='roll'?'This run uses a rolling bass. It plays every sixteenth note between the kicks.':'This run uses an off-beat bass. It plays one note halfway between each pair of kicks.',f:(p,c)=>{const roll=c.G.bassShape==='roll';let on=0,off=0;for(let i=0;i<16;i++)if(p[i]>=0){if(roll?i%4!==0:i%4===2)on++;else off++}return on?on/(roll?12:4)*on/(on+off):0}}],
 rules2:[MIX]},
{id:'chords',name:'Chords',long:'chords',K:8,rounds:2,minBars:4,maxBars:8,
 init:(r,c)=>({roots:[0,1,2,3].map(()=>pick(r,c.G.allowed)),inv:[0,1,2,3].map(()=>ri(r,0,2)),hit:randBin(r,ri(r,1,4))}),
 mutate:(p,r,c)=>{const q={roots:p.roots.slice(),inv:p.inv.slice(),hit:p.hit},m=r();
  if(m<.35)q.hit=flip(p.hit,r);
  else if(m<.72)q.roots[ri(r,0,3)]=pick(r,c.G.allowed);
  else if(m<.84){const i=ri(r,1,3);q.roots[i]=q.roots[i-1];q.inv[i]=q.inv[i-1]}
  else q.inv[ri(r,0,3)]=ri(r,0,2);
  return q},
 neigh:(p,c)=>{const out=binN(p.hit).map(h=>({roots:p.roots,inv:p.inv,hit:h}));for(let i=0;i<4;i++){for(const d of c.G.allowed)if(d!==p.roots[i]){const r=p.roots.slice();r[i]=d;out.push({roots:r,inv:p.inv,hit:p.hit})}for(let v=0;v<3;v++)if(v!==p.inv[i]){const n=p.inv.slice();n[i]=v;out.push({roots:p.roots,inv:n,hit:p.hit})}if(i>0&&p.roots[i]!==p.roots[i-1]){const r=p.roots.slice(),n=p.inv.slice();r[i]=r[i-1];n[i]=n[i-1];out.push({roots:r,inv:n,hit:p.hit})}}
  for(const x of new Set(p.roots))for(const y of c.G.allowed)if(y!==x)out.push({roots:p.roots.map(v=>v===x?y:v),inv:p.inv,hit:p.hit});
  for(let k=1;k<4;k++)out.push({roots:p.roots.map((v,i)=>p.roots[(i+k)%4]),inv:p.inv.map((v,i)=>p.inv[(i+k)%4]),hit:p.hit});
  return out},
 rules:[
  {n:'Starts at home',w:3,src:'krumhansl',why:'Bar 1 uses the home chord, so the ear knows the key.',f:p=>p.roots[0]===0?1:0},
  {n:'Strong root moves',w:2.5,src:'tymoczko',why:'Chord roots move by a step, a third or a fourth. Each run weighs these moves a little differently.',f:(p,c)=>{let s=0,n=0;for(let i=0;i<4;i++){const a=p.roots[i],b=p.roots[(i+1)%4];if(a!==b){s+=c.G.move[(b-a+7)%7];n++}}return n?s/n:1}},
  {n:'Smooth voice leading',w:2.5,src:'tymoczko',why:'Each note of a chord moves the shortest way to a note of the next chord.',f:(p,c)=>{const v=p.roots.map((x,i)=>voicing(x,p.inv[i],c.G));let s=0,n=0;for(let i=0;i<4;i++){const j=(i+1)%4;if(p.roots[i]!==p.roots[j]||p.inv[i]!==p.inv[j]){s+=vlDist(v[i],v[j]);n++}}return n?c01(1-(s/n-1)/3):1}},
  {n:'Right amount of change',w:2,why:G=>'This run wants '+plural(G.variety,'different chord')+' in its 4-bar loop.',f:(p,c)=>near(new Set(p.roots).size,c.G.variety,2)},
  {n:"This run's taste",w:1.5,why:'Each run prefers some chords at random. That is one reason runs differ. Every chord stays in the scale.',f:(p,c)=>(c.G.taste[p.roots[1]]+c.G.taste[p.roots[2]]+c.G.taste[p.roots[3]])/3},
  {n:'Chord rhythm',w:2,src:'witek',why:G=>'This part plays short chord hits. This run wants about '+G.chordN+' per bar, placed off the beat. The pad holds the long chords.',f:(p,c)=>{const n=cnt(p.hit);return n?.5*near(n,c.G.chordN,3)+.5*near(sync(p.hit),c.G.chordSync,5):0}}],
 rules2:[MIX,CROWD]},
{id:'pad',name:'Pad',long:'pad',K:6,rounds:2,minBars:2,maxBars:4,
 init:r=>randBin(r,ri(r,6,14)),mutate:(p,r)=>flip(p,r),neigh:p=>binN(p).concat(PADSEEDS),
 rules:[
  {n:'Starts with the bar',w:2,why:'The pad begins on the first beat, so each chord change is clear.',f:p=>p[0]?1:0},
  {n:'Right shape',w:3,why:G=>G.padSeg===1?'This run holds one long chord per bar.':'This run chops the pad into '+G.padSeg+' pulses per bar. Producers call this a gate.',f:(p,c)=>{let s=0;for(let i=0;i<16;i++)if(p[i]&&(i===0||!p[i-1]))s++;return s?near(s,c.G.padSeg,2):0}},
  {n:'Mostly sounding',w:2,why:G=>'The pad sounds for about '+Math.round((G.padSeg>=4?.5:G.padCover)*100)+'% of the bar. The rest is a breath before the next chord.',f:(p,c)=>near(cnt(p)/16,c.G.padSeg>=4?.5:c.G.padCover,.4)},
  {n:'Even pulses',w:2,src:'toussaint',why:'When the pad is chopped, the pulses start at even distances.',f:p=>{const st=p.map((x,i)=>x&&(i===0||!p[i-1])?1:0);return cnt(st)>1?evenness(st):1}}]},
{id:'arp',name:'Arp',long:'arpeggio',pitch:true,K:8,rounds:2,minBars:3,maxBars:6,
 init:r=>{const p=Array(16).fill(-1),n=ri(r,4,12);for(let k=0;k<n;k++)p[ri(r,0,15)]=ri(r,0,5);return p},
 mutate:(p,r)=>{const q=p.slice(),i=ri(r,0,15);q[i]=q[i]<0||r()<.5?ri(r,0,5):-1;return q},
 neigh:(p,c)=>idxN(p,5).concat(arpSeeds(c.G)),
 rules:[
  {n:'Right amount',w:3,why:G=>'This run wants about '+plural(G.arpN,'note')+' per bar.',f:(p,c)=>near(cnt(bin(p)),c.G.arpN,4)},
  {n:'Follows a shape',w:2.5,why:G=>({up:'This run climbs the chord from low to high, then starts again.',down:'This run falls through the chord from high to low, then starts again.',updown:'This run moves one chord note at a time, up and then down.',free:'This run skips around the chord and never repeats a note twice in a row.'})[G.arpDir],f:(p,c)=>{const v=p.filter(x=>x>=0),d=c.G.arpDir;if(v.length<2)return 0;let ok=0;for(let i=0;i<v.length;i++){const x=v[(i+1)%v.length]-v[i];if(d==='up'?(x===1||x<=-2):d==='down'?(x===-1||x>=2):d==='updown'?Math.abs(x)===1:(x!==0&&Math.abs(x)<=3))ok++}return ok/v.length}},
  {n:'Repeating cell',w:2,src:'butler',why:G=>'The pattern repeats every '+G.arpPer+' steps.'+(G.arpPer===3?' That cuts across the four-beat bar. It is a common device in techno and trance.':''),f:(p,c)=>{const k=c.G.arpPer;let s=0;for(let i=0;i<16-k;i++)if(p[i]===p[i+k])s++;return s/(16-k)}},
  {n:'Uses the range',w:1,why:'The arpeggio uses at least three different chord notes.',f:p=>Math.min(1,new Set(p.filter(x=>x>=0)).size/3)}],
 rules2:[MIX,CROWD,ROOM],rules2r:[MIX]},
{id:'lead',name:'Lead',long:'lead melody',pitch:true,K:8,rounds:3,minBars:4,maxBars:8,
 init:(r,c)=>{const p=Array(32).fill(-1),riff=!!(c&&c.G.riff),n=riff?ri(r,22,30):ri(r,6,14);let d=pick(r,[0,2,4,7]);for(let k=0;k<n;k++){d=Math.max(0,Math.min(9,d+(riff&&r()<.7?0:ri(r,-2,2))));p[ri(r,0,31)]=d}return p},
 mutate:(p,r)=>{const q=p.slice(),i=ri(r,0,31),m=r();
  if(m<.12){const j=ri(r,0,15);q[j+16]=q[j];return q}
  if(q[i]<0){let prev=-1;for(let k=1;k<32;k++){const v=q[(i-k+32)%32];if(v>=0){prev=v;break}}q[i]=prev<0?pick(r,[0,2,4,7]):Math.max(0,Math.min(9,prev+ri(r,-2,2)))}
  else if(m<.5)q[i]=-1;
  else q[i]=Math.max(0,Math.min(9,q[i]+pick(r,[-2,-1,1,2])));
  return q},
 neigh:p=>{const out=[];for(let i=0;i<32;i++){for(let v=-1;v<10;v++)if(v!==p[i]){const q=p.slice();q[i]=v;out.push(q)}}for(let j=0;j<16;j++)if(p[j]!==p[j+16]){const a=p.slice();a[j+16]=p[j];out.push(a);const b=p.slice();b[j]=p[j+16];out.push(b)}return out},
 rules:[
  {n:'Fits the chords',w:3,src:'plomp',why:'Notes on strong beats belong to the chord. Notes one semitone above a chord note are avoided because they sound rough.',f:(p,c)=>{const pr=c.pat.chords?c.pat.chords.roots:[0,0,0,0],G=c.G;let s=0,w=0;for(let b=0;b<4;b++){const pcs=chordDegs(pr[b],G).map(d=>((semi(d,G)%12)+12)%12),o=(b%2)*16;for(let i=0;i<16;i++){const v=p[o+i];if(v<0)continue;const n=G.scale[v%7];let fit=.6;if(pcs.includes(n))fit=1;else if(pcs.some(x=>(n-x+12)%12===1))fit=.1;s+=fit*W[i];w+=W[i]}}return w?s/w:0}},
  {n:'Small steps',w:2,src:'huron',why:G=>G.leadStep<.6?'This style drives one note in fast sixteenths. Most notes repeat the one before, and the line moves only now and then.':'Most melodies move by small steps. That makes the notes sound like one line.',f:(p,c)=>{const v=p.filter(x=>x>=0);if(v.length<2)return 0;let d=0;for(let i=0;i<v.length;i++)d+=Math.abs(v[(i+1)%v.length]-v[i]);return near(d/v.length,c.G.leadStep,c.G.riff?1.2:2.5)}},
  {n:'Question and answer',w:2.5,src:'caplin',why:'The melody lasts two bars. Bar 1 asks: it ends away from the home note. Bar 2 answers with a similar rhythm and ends on the home note.',f:p=>{let r=0,qe=-1,ae=-1;for(let i=0;i<16;i++){if((p[i]>=0)===(p[i+16]>=0))r++;if(p[i]>=0)qe=p[i];if(p[i+16]>=0)ae=p[i+16]}const qs=qe<0?0:(qe%7===0?.3:1),as=ae<0?0:(ae%7===0?1:(ae%7===2||ae%7===4)?.6:.2);return .4*near(r/16,.8,.6)+.3*qs+.3*as}},
  {n:'Right amount',w:1.5,wr:5,why:G=>'This run wants about '+plural(G.leadN,'note')+' per bar.',f:(p,c)=>near(cnt(bin(p))/2,c.G.leadN,4)},
  {n:'Push and pull',w:1.5,src:'witek',why:SYNC_WHY,f:(p,c)=>{let s=0;for(let h=0;h<2;h++){const b=bin(p.slice(h*16,h*16+16));s+=cnt(b)?near(sync(b),c.G.leadSync,5):0}return s/2}}],
 rules2:[MIX,CROWD,ANSWER],rules2r:[MIX]}
];

function rulesOf(L,pass,G){const b=G&&G.bassShape&&L.rulesR?L.rules.concat(L.rulesR):L.rules;return pass===2&&L.rules2?b.concat(G&&G.riff&&L.rules2r?L.rules2r:L.rules2):b}
function evalPat(L,p,ctx){const R=rulesOf(L,ctx.pass,ctx.G),riff=ctx.G.riff,parts=R.map(r=>c01(r.f(p,ctx,L)));let s=0,w=0;R.forEach((r,i)=>{const k=riff&&r.wr||r.w;s+=k*parts[i];w+=k});return{total:s/w,parts}}
function newSearch(i,ctx,rng){const L=LAYERS[i],two=ctx.pass===2,pat=two?ctx.pat[L.id]:L.init(rng,ctx),sc=evalPat(L,pat,ctx);
  return{L,i,pass:two?2:1,pat,score:sc.total,parts:sc.parts,cands:[],tried:1,bars:1,stale:0,done:false,min:two?1:L.minBars,max:two?4:L.maxBars}}
function round(S,ctx,rng){const cs=S.L.neigh(S.pat,ctx);for(let k=0;k<S.L.K;k++)cs.push(S.L.mutate(S.L.mutate(S.pat,rng,ctx),rng,ctx));
  let best=null,bs=-1,ties=0;
  for(const m of cs){const sc=evalPat(S.L,m,ctx);S.cands.push(sc.total);S.tried++;if(sc.total>bs+1e-9){best={m,sc};bs=sc.total;ties=1}else if(sc.total>bs-1e-9&&rng()<1/++ties)best={m,sc}}
  if(bs>S.score+1e-9){S.pat=best.m;S.score=bs;S.parts=best.sc.parts;return true}return false}
function polish(S,ctx,rng){let n=0;while(n++<40&&round(S,ctx,rng));S.done=true}
function stepSearch(S,ctx,rng){let improved=false;S.cands=[];
  for(let r=0;r<S.L.rounds;r++){if(round(S,ctx,rng))improved=true;else break}
  S.bars++;S.stale=improved?0:S.stale+1;
  if(S.bars>=S.min&&S.stale>=1)S.done=true;
  else if(S.bars>=S.max)polish(S,ctx,rng)}
function runAll(seed,want,brief){const G=makeGenome(seed,want,brief),r=rngFrom(seed*31+7),ctx={G,pat:{},pass:1,F:F0},out=[],out2=[];
  for(let i=0;i<LAYERS.length;i++){const S=newSearch(i,ctx,r);ctx.pat[S.L.id]=S.pat;while(!S.done){stepSearch(S,ctx,r);ctx.pat[S.L.id]=S.pat}out.push(S)}
  ctx.pass=2;for(const id of PASS2){const S=newSearch(IDS.indexOf(id),ctx,r);while(!S.done){stepSearch(S,ctx,r);ctx.pat[id]=S.pat}out2.push(S)}
  return{G,ctx,out,out2}}

// ---- arrangement: 72 bars, one entry per bar. Each style family has its own section plan. ----
function makePlan(G){const all=IDS.slice(),noLead=all.filter(x=>x!=='lead'),late=G.lateLead;
  const secs=G.plan==='techno'?[
    {n:'Intro',len:8,on:['kick','hat'],add:{4:['perc']}},
    {n:'Groove',len:16,on:['kick','hat','perc','clap','ohat','bass'],add:{8:['arp']}},
    {n:'Peak A',len:16,on:noLead,add:{8:['lead']},drop:true},
    {n:'Break',len:4,on:['pad','chords','arp'],lp:[1200,6000]},
    {n:'Build',len:4,on:['pad','chords','arp','perc','hat','lead'],build:true,lp:[6000,18000],hp:[30,400]},
    {n:'Peak B',len:16,on:all,big:true,drop:true},
    {n:'Outro',len:8,on:['kick','hat','perc','bass'],cut:{4:['bass']}}]
  :G.plan==='trance'?[
    {n:'Intro',len:8,on:['kick','hat'],add:{4:['bass','ohat']}},
    {n:'Groove',len:8,on:['kick','hat','ohat','clap','bass','perc','arp']},
    {n:'Drop A',len:8,on:all,drop:true},
    {n:'Break',len:16,on:['pad'],add:{4:['chords'],8:['lead','arp']},lp:[700,4500]},
    {n:'Build',len:8,on:['pad','chords','lead','arp','hat'],build:true,lp:[4500,18000],hp:[30,500]},
    {n:'Drop B',len:16,on:all,big:true,drop:true},
    {n:'Outro',len:8,on:['kick','hat','ohat','bass','pad'],cut:{4:['bass','ohat']}}]
  :[
    {n:'Intro',len:8,on:['kick','hat'],add:{4:['perc']}},
    {n:'Groove',len:8,on:['kick','hat','perc','clap','ohat','bass'],add:{4:['arp']}},
    {n:'Drop A',len:16,on:late?noLead:all,add:late?{8:['lead']}:{},drop:true},
    {n:'Break',len:8,on:['pad','chords','lead'],add:{4:['perc','arp']},lp:[900,5000]},
    {n:'Build',len:8,on:['pad','chords','lead','arp','perc','hat'],build:true,lp:[5000,18000],hp:[30,450]},
    {n:'Drop B',len:16,on:all,big:true,drop:true},
    {n:'Outro',len:8,on:['kick','hat','perc','clap','bass','pad'],cut:{4:['clap','bass','pad']}}];
  const plan=[];
  secs.forEach((sc,si)=>{const on={};sc.on.forEach(x=>{on[x]=1});const f=(a,k)=>a[0]*Math.pow(a[1]/a[0],k/sc.len);
    for(let i=0;i<sc.len;i++){if(sc.add&&sc.add[i])sc.add[i].forEach(x=>{on[x]=1});if(sc.cut&&sc.cut[i])sc.cut[i].forEach(x=>{delete on[x]});
      const e=sc.len-1-i;
      plan.push({si,n:sc.n,i,len:sc.len,e,on:Object.assign({},on),first:i===0,drop:!!sc.drop,big:!!sc.big,build:!!sc.build,roll:!!sc.build&&e<=3,
        fill:on.kick?((i+1)%8===0?2:(i+1)%4===0?1:0):0,
        lp:sc.lp?[f(sc.lp,i),f(sc.lp,i+1)]:[18000,18000],hp:sc.hp?[f(sc.hp,i),f(sc.hp,i+1)]:[30,30]})}});
  plan.forEach((b,k)=>{const nx=plan[(k+1)%plan.length];b.pre=nx.first&&nx.drop&&!b.build});
  return plan}
// What actually sounds in one bar: patterns plus fills, rolls and section changes. pb = null during the search.
function renderBar(P,G,pb,cb){const on=id=>P[id]&&(!pb||pb.on[id]),fill=pb?pb.fill:0,
    L={bi:cb%4,v:{},pd:null,bass:null,lead:null,chordHit:null,pad:null,arp:null,ride:null,oct:false,gapFrom:16,roll:!!(pb&&pb.roll),rp:pb&&pb.roll?(3-pb.e)/4:0};
  if(on('kick')){L.v.kick=P.kick.map((x,i)=>x?(i%4===0?1:.78):0);if(fill===2){if(G.fillKind===0)for(let s=12;s<16;s++)L.v.kick[s]=0;else{L.v.kick[14]=.8;L.v.kick[15]=.9}}}
  if(on('clap')){L.v.clap=P.clap.map(x=>LV[x]);if(fill===1&&!L.v.clap[15])L.v.clap[15]=.35;if(fill===2)for(let k=0;k<4;k++)L.v.clap[12+k]=Math.max(L.v.clap[12+k],.4+.18*k)}
  if(L.roll){const c=Array(16).fill(0),e=pb.e;for(let s=0;s<16;s++){if(e>=2){if(s%4===0)c[s]=.45}else if(e===1){if(s%2===0)c[s]=.4+.02*s}else c[s]=.35+.05*s}L.v.clap=c}
  if(on('hat')){L.v.hat=P.hat.map(x=>LV[x]);if(pb&&pb.big)for(let s=1;s<16;s+=2)if(!L.v.hat[s])L.v.hat[s]=.3;if(fill===1){L.v.hat[13]=Math.max(L.v.hat[13],.5);L.v.hat[15]=Math.max(L.v.hat[15],.6)}}
  if(on('ohat')){L.v.ohat=P.ohat.map(x=>x?1:0);if(fill>=1&&!(L.v.kick&&L.v.kick[14]))L.v.ohat[14]=1}
  if(L.v.hat&&L.v.ohat)for(let s=0;s<16;s++)if(L.v.ohat[s])L.v.hat[s]=0;
  if(on('perc')){L.pd=P.perc.slice();L.v.perc=P.perc.map((x,i)=>x?(i%4===2?1:i%2?.6:.85):0);
    if(fill===2&&G.fillKind===1)for(let k=0;k<4;k++){L.v.perc[12+k]=Math.max(L.v.perc[12+k],.5+.15*k);if(!L.pd[12+k])L.pd[12+k]=3-(k%3)}}
  if(on('bass')){L.bass=P.bass.slice();if(fill>=1){if(!(L.v.kick&&L.v.kick[13]))L.bass[13]=2;if(!(L.v.kick&&L.v.kick[15]))L.bass[15]=1}}
  if(on('chords'))L.chordHit=P.chords.hit.slice();
  if(on('pad'))L.pad=P.pad.slice();
  if(on('arp'))L.arp=P.arp.slice();
  if(on('lead')){const o=(cb%2)*16;L.lead=P.lead.slice(o,o+16);L.oct=!!(pb&&pb.big)}
  if(pb&&pb.big)L.ride=W.map((x,i)=>i%2?0:(i%4===2?.9:.6));
  if(pb&&pb.build&&pb.e===0)L.gapFrom=12;
  return L}
