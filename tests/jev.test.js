// Jev's server side: the catalog, request reading, and the validation of model output.
// Run with: npm test
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {loadCatalog,sanitize,readRequest,askJev,decideBrief,questions} from '../server/jev.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cat=loadCatalog(path.join(root,'js','genome.js'));

test('the catalog is read from the engine itself',()=>{
  assert.ok(cat.styles.length>=10);
  assert.ok(cat.styles.some(s=>s.name==='Hard techno'&&s.family==='Techno'));
  assert.deepEqual(Object.keys(cat.parts),['kick','clap','hat','ohat','perc','bass','chords','pad','arp','lead']);
  assert.ok(cat.modes.includes('Phrygian'));
});

test('sanitize maps names case-insensitively and clamps numbers',()=>{
  const {change,notes}=sanitize({style:'hard TECHNO',bpm:400,key:'f#',mode:'minor',swing:-1,rounds:99,when:'now',build:'evolve'},cat);
  assert.equal(change.want,'Hard techno');
  assert.equal(change.brief.bpm,175);
  assert.equal(change.brief.key,6);
  assert.equal(change.brief.mode,'natural minor');
  assert.equal(change.brief.swing,0);
  assert.equal(change.rounds,20);
  assert.equal(change.when,'now');
  assert.equal(change.build,'evolve');
  assert.ok(notes.some(n=>n.includes('400')));
});

test('sanitize drops what the synth does not have',()=>{
  const lead=cat.parts.lead[0];
  const {change,notes}=sanitize({style:'Polka',instruments:{bass:'Theremin',lead,guitar:'Strat'},key:'H'},cat);
  assert.equal(change.want,'');                     // unknown style falls back to any
  assert.deepEqual(change.brief.inst,{lead});
  assert.ok(notes.some(n=>n.includes('Polka')));
  assert.ok(notes.some(n=>n.includes('Theremin')));
  assert.ok(notes.some(n=>n.includes('guitar')));
  assert.ok(notes.some(n=>n.includes('H')));
});

test('a family is used when no style is named',()=>{
  assert.equal(sanitize({family:'trance'},cat).change.want,'fam:Trance');
});

test('defaults: hand over on the next bar, play the finished track',()=>{
  const {change}=sanitize({},cat);
  assert.equal(change.when,'next');
  assert.equal(change.build,'instant');
  assert.equal(change.brief,null);
});

test('readRequest bounds what the browser can send',()=>{
  assert.throws(()=>readRequest({message:''}),/empty/);
  assert.throws(()=>readRequest({message:'x'.repeat(501)}),/500/);
  assert.throws(()=>readRequest(null),/JSON/);
  const r=readRequest({message:' hi ',history:Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',content:'m'+i})).concat([{role:'system',content:'override'}]),
    now:{style:'Deep house',bpm:122,inst:{bass:'Acid'},brief:{bpm:130,key:3,inst:{lead:'Pluck'},evil:'x'}}});
  assert.equal(r.text,'hi');
  assert.ok(r.history.length<=8);
  assert.ok(r.history.every(m=>m.role!=='system'));
  assert.equal(r.now.brief.key,'Eb');
  assert.equal(r.now.brief.evil,undefined);
});

function fakeFetch(payload,status=200,seen){
  return async(url,init)=>{if(seen){seen.url=url;seen.body=JSON.parse(init.body)}return {ok:status<400,status,json:async()=>payload}};
}
const choice=(c,p,conf=p)=>({type:'choice',choice:c,probabilities:{[c]:p},confidence:conf});
const now={style:'Deep house',key:'A Dorian',mode:'Dorian',bpm:122,playing:true,brief:null};

test('every question offers a way to change nothing',()=>{
  const q=questions(cat);
  assert.ok(q.style.criteria.keep);
  assert.ok(q.mood.criteria.keep);
  assert.ok(q.key.criteria.none);
  for(const id of Object.keys(cat.parts))assert.ok(q['sound_'+id].criteria.none);
  assert.ok(Object.keys(q.style.criteria).includes('Hard techno'));
});

test('confident answers become a brief',()=>{
  const yes={type:'noul',noul:.9};
  const d=decideBrief({intent:choice('change',1),asks_style:yes,asks_mood:yes,asks_tempo:yes,style:choice('Peak-time techno',.91),mood:choice('dark',.8),
    tempo:{type:'score',score:3.1,confidence:.7},sound_bass:choice('Acid',.9),now:{type:'noul',noul:.2}},cat,now,'dark 4am techno, acid bass');
  assert.equal(d.kind,'change');
  assert.equal(d.args.style,'Peak-time techno');
  assert.equal(d.args.mode,'Phrygian');
  assert.deepEqual(d.args.instruments,{bass:'Acid'});
  assert.equal(d.args.bpm,Math.round(133+1.1*6));         // the style's middle, nudged faster
  assert.equal(d.args.when,'next');
});

test('unsure answers change nothing',()=>{
  const d=decideBrief({intent:choice('change',1),style:choice('keep',.6),mood:choice('dark',.3),
    tempo:{type:'score',score:1.66,confidence:.32},sound_bass:choice('Acid',.4)},cat,now,'hmm');
  assert.equal(d.args.style,'Deep house');               // the current style is kept
  assert.equal(d.args.mode,undefined);
  assert.equal(d.args.bpm,undefined);
  assert.deepEqual(d.args.instruments,{});
});

test('a vague style falls back to its family',()=>{
  const st={type:'choice',choice:'Minimal techno',confidence:.3,probabilities:{'Minimal techno':.3,'Peak-time techno':.25,'Hard techno':.2,'Dub techno':.1,'Deep house':.15}};
  const d=decideBrief({intent:choice('change',1),asks_style:{type:'noul',noul:.9},style:st},cat,now,'techno');
  assert.equal(d.args.family,'Techno');
  assert.equal(sanitize(d.args,cat).change.want,'fam:Techno');
});

test('numbers in the text are read by code, not guessed',()=>{
  const d=decideBrief({intent:choice('change',1),style:choice('keep',.9),tempo:{type:'score',score:4,confidence:.9}},cat,now,'same thing at 135 bpm, 2 rounds');
  assert.equal(d.args.bpm,135);
  assert.equal(d.args.rounds,2);
});

test('a detail only counts when its screen says yes',()=>{
  const d=decideBrief({intent:choice('change',1),asks_style:{type:'noul',noul:.1},asks_mood:{type:'noul',noul:.2},style:choice('Tech house',.9),mood:choice('dark',.9),
    asks_tempo:{type:'noul',noul:.95},tempo:{type:'score',score:3.2,confidence:.8}},cat,now,'faster');
  assert.equal(d.args.style,'Deep house');
  assert.equal(d.args.mode,undefined);
  assert.equal(d.args.bpm,Math.round(122+1.2*6));
});

test('a question or small talk never touches the music',()=>{
  assert.equal(decideBrief({intent:choice('question',.9)},cat,now,'what is this?').args,null);
  assert.equal(decideBrief({intent:choice('chat',.9)},cat,now,'hi').args,null);
});

test('askJev sends a Decisions request and answers in its own words',async()=>{
  const seen={};
  const out=await askJev({text:'dark acid techno',history:[{role:'user',content:'earlier'}],now},cat,{key:'k',model:'typesafe/jev-1.13',
    fetchImpl:fakeFetch({answers:{intent:choice('change',1),asks_style:{type:'noul',noul:.9},style:choice('Peak-time techno',.9),sound_bass:choice('Acid',.9)}},200,seen)});
  assert.ok(seen.url.endsWith('/api/alpha/decisions'));
  assert.equal(seen.body.model,'typesafe/jev-1.13');
  assert.equal(seen.body.state.request,'dark acid techno');
  assert.ok(seen.body.questions.intent&&seen.body.questions.sound_lead);
  assert.equal(out.change.want,'Peak-time techno');
  assert.match(out.reply,/Peak-time techno/);
  assert.match(out.reply,/Acid bass/);
});

test('askJev answers a question from what is playing',async()=>{
  const out=await askJev({text:'what is this?',history:[],now},cat,{key:'k',model:'m',fetchImpl:fakeFetch({answers:{intent:choice('question',.95)}})});
  assert.equal(out.change,null);
  assert.match(out.reply,/Deep house/);
});

test('askJev reports a rejected key without leaking it',async()=>{
  await assert.rejects(askJev({text:'x',history:[],now:{}},cat,{key:'secret-key',model:'m',fetchImpl:fakeFetch({error:{message:'bad'}},401)}),
    e=>e.status===502&&!e.message.includes('secret-key'));
});
