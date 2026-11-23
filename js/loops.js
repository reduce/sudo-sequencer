// ---------- saved loops ----------
// A club track is fully described by its seed, the style filter and the instrument picks.
// The patterns, tempo, key and arrangement are all derived from those three things,
// so a saved loop is a few hundred bytes instead of a rendered file.
//
// Storage: localStorage, one array under sudo.loops.v1.
// Also: JSON import/export, a share link, and a per-loop MIDI export that re-runs the
// search offline with runAll() (no audio) so the MIDI is the same as the one the view makes.
(function(){
  'use strict';
  const KEY='sudo.loops.v1';
  const $=id=>document.getElementById(id);

  const el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e};
  const note=txt=>{const n=$('loopNote');if(n)n.textContent=txt};

  function read(){
    try{
      const raw=localStorage.getItem(KEY);
      if(!raw)return [];
      const list=JSON.parse(raw);
      if(!Array.isArray(list))return [];
      return list.filter(x=>x&&typeof x.seed==='number'&&isFinite(x.seed));
    }catch(e){return []}
  }
  function write(list){
    try{localStorage.setItem(KEY,JSON.stringify(list));return true}
    catch(e){note('This browser would not store the loop list ('+(e&&e.name||'error')+'). Export instead.');return false}
  }

  const state=()=>(window.__bl&&window.__bl.state)?window.__bl.state():null;
  const label=s=>s?s.style+' · '+s.key+' · '+s.bpm+' BPM':'this run';

  function same(a,b){
    if(a.seed!==b.seed||(a.want||'')!==(b.want||''))return false;
    const A=a.inst||{},B=b.inst||{};
    const ks=new Set(Object.keys(A).concat(Object.keys(B)));
    for(const k of ks)if(A[k]!==B[k])return false;
    if(a.pat||b.pat)return JSON.stringify(a.pat||null)===JSON.stringify(b.pat||null);
    return true;
  }

  function snapshot(){
    const s=state();
    if(!s)return null;
    return{seed:s.seed,want:s.want||'',style:s.style,key:s.key,bpm:s.bpm,inst:Object.assign({},s.inst),
      genome:s.genome?JSON.parse(JSON.stringify(s.genome)):null,
      pat:s.pat?JSON.parse(JSON.stringify(s.pat)):null};
  }

  function saveLoop(){
    const s=snapshot();
    if(!s){note('The track view is still loading.');return}
    const typed=($('loopName').value||'').trim();
    const now=Date.now();
    const list=read();
    const hit=list.find(x=>same(x,s));
    if(hit){
      hit.name=typed||hit.name;
      hit.updatedAt=now;
      hit.style=s.style;hit.key=s.key;hit.bpm=s.bpm;
      write(list);
      note('Updated "'+hit.name+'".');
    }else{
      list.unshift({
        id:'lp_'+now.toString(36)+'_'+Math.floor(Math.random()*1e6).toString(36),
        name:typed||label(s),seed:s.seed,want:s.want,style:s.style,key:s.key,bpm:s.bpm,
        inst:s.inst,genome:s.genome,pat:s.pat,createdAt:now,updatedAt:now});
      write(list);
      note('Saved "'+(typed||label(s))+'". '+list.length+' loop'+(list.length===1?'':'s')+' stored.');
    }
    $('loopName').value='';
    render();
  }

  function loadLoop(loop){
    if(!window.__bl||!window.__bl.load){note('The track view is still loading.');return}
    window.__bl.load({seed:loop.seed,want:loop.want||'',inst:loop.inst||{},genome:loop.genome||null,pat:loop.pat||null});
    if(location.hash!=='#club'){location.hash='club'}
    else{const tab=$('tabClub');if(tab&&tab.getAttribute('aria-selected')!=='true')tab.click()}
    note('Loaded "'+loop.name+'". Press Start to play it.');
  }

  async function midiFor(loop){
    const st={seed:loop.seed,want:loop.want||'',inst:loop.inst||{},genome:loop.genome||null,pat:loop.pat||null};
    const d=await window.DLP;
    if(!d)return;
    try{
      const midi=window.__bl.midiFor(st);
      const base='sudo-sequencer-'+loop.seed;
      await d.save({filename:base+'.zip',data:zipStore([{name:base+'.mid',data:midi}])});
      note('Saved '+base+'.zip with the 72-bar MIDI.');
    }catch(e){
      note('Could not build the MIDI for that loop.');
    }
  }

  function link(loop){
    const st={seed:loop.seed,want:loop.want||'',inst:loop.inst||{}};
    const url=location.origin+location.pathname+'?loop='+encodeURIComponent(btoa(JSON.stringify(st)));
    const done=()=>note('Link copied.');
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(done,()=>window.prompt('Copy this link',url));
    }else window.prompt('Copy this link',url);
  }

  function rename(loop){
    const name=window.prompt('Rename this loop',loop.name);
    if(name==null)return;
    const list=read(),hit=list.find(x=>x.id===loop.id);
    if(!hit)return;
    hit.name=name.trim()||hit.name;
    hit.updatedAt=Date.now();
    write(list);render();
  }

  function remove(loop){
    if(!window.confirm('Delete "'+loop.name+'"?'))return;
    const list=read().filter(x=>x.id!==loop.id);
    write(list);render();
    note('Deleted. '+list.length+' loop'+(list.length===1?'':'s')+' left.');
  }

  async function exportAll(){
    const list=read();
    if(!list.length){note('There is nothing to export yet.');return}
    const d=await window.DLP;
    if(!d)return;
    const payload={app:'sudo-sequencer',v:1,exportedAt:new Date().toISOString(),loops:list};
    const bytes=new TextEncoder().encode(JSON.stringify(payload,null,2));
    await d.save({filename:'sudo-sequencer-loops.json',data:bytes});
    note('Exported '+list.length+' loop'+(list.length===1?'':'s')+'.');
  }

  async function importFile(file){
    if(!file)return;
    try{
      const text=await file.text();
      const data=JSON.parse(text);
      const incoming=Array.isArray(data)?data:(data&&Array.isArray(data.loops)?data.loops:null);
      if(!incoming)throw new Error('no loops');
      const list=read();
      let added=0;
      for(const raw of incoming){
        if(!raw||typeof raw.seed!=='number'||!isFinite(raw.seed))continue;
        const now=Date.now();
        const loop={
          id:raw.id||'lp_'+now.toString(36)+'_'+Math.floor(Math.random()*1e6).toString(36),
          name:raw.name||('Run #'+raw.seed),
          seed:raw.seed,want:raw.want||'',style:raw.style||'',key:raw.key||'',bpm:raw.bpm||0,
          inst:raw.inst&&typeof raw.inst==='object'?raw.inst:{},
          createdAt:raw.createdAt||now,updatedAt:now};
        const hit=list.find(x=>x.id===loop.id)||list.find(x=>same(x,loop));
        if(hit){Object.assign(hit,loop,{id:hit.id,createdAt:hit.createdAt});}
        else{list.unshift(loop);added++}
      }
      list.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
      write(list);render();
      note(added?'Imported '+added+' loop'+(added===1?'':'s')+'.':'The file had no new loops.');
    }catch(e){
      note('That file is not a Sudo Sequencer loop export.');
    }
  }

  // ---------- the list ----------
  function render(){
    const host=$('loopList');
    if(!host)return;
    const list=read().sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
    host.textContent='';
    if(!list.length){
      host.append(el('li','lrow lempty','No loops saved yet. Press Save loop to keep the track that is playing.'));
      note('Loops stay in this browser.');
      return;
    }
    for(const loop of list){
      const li=el('li','lrow');
      const meta=el('div','lmeta');
      const filter=loop.want&&loop.want!==loop.style?'filter: '+loop.want:'';
      meta.append(el('span','lname2',loop.name),
        el('span','lsub',[loop.style||'run',loop.key,loop.bpm?loop.bpm+' BPM':'',filter].filter(Boolean).join(' · ')));
      const acts=el('div','lacts');
      const mk=(text,cls,fn)=>{const b=el('button','lbtn'+(cls?' '+cls:''),text);b.type='button';b.addEventListener('click',fn);return b};
      acts.append(mk('Load','',()=>loadLoop(loop)),
        mk('MIDI','',()=>midiFor(loop)),
        mk('Link','',()=>link(loop)),
        mk('Rename','',()=>rename(loop)),
        mk('Delete','danger',()=>remove(loop)));
      li.append(meta,acts);
      host.append(li);
    }
  }

  // ---------- a shared loop arrives as ?loop= ----------
  function fromQuery(){
    const q=new URLSearchParams(location.search).get('loop');
    if(!q)return null;
    try{
      const st=JSON.parse(atob(decodeURIComponent(q)));
      if(!st||typeof st.seed!=='number'||!isFinite(st.seed))return null;
      return{seed:st.seed,want:st.want||'',inst:st.inst&&typeof st.inst==='object'?st.inst:{}};
    }catch(e){return null}
  }

  // ---------- wiring ----------
  function start(){
    const card=$('loopsCard');
    if(!card)return;
    $('loopSave').addEventListener('click',saveLoop);
    $('loopName').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();saveLoop()}});
    $('loopExport').addEventListener('click',exportAll);
    $('loopImport').addEventListener('click',()=>$('loopFile').click());
    $('loopFile').addEventListener('change',e=>{const f=e.target.files&&e.target.files[0];importFile(f).finally(()=>{e.target.value=''});});
    render();

    const shared=fromQuery();
    if(shared&&window.__bl&&window.__bl.load){
      window.__bl.load({seed:shared.seed,want:shared.want,inst:shared.inst});
      if(location.hash!=='#club')location.hash='club';
      note('Loaded the shared loop #'+shared.seed+'. Press Start to play it, or Save loop to keep it.');
    }
  }

  window.__loops={read,save:saveLoop,render};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);
  else start();
})();
