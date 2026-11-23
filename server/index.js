// Sudo Sequencer's server: the static app, plus /api/jev, which holds the OpenRouter key.
// The key is read from the environment (or .env, which git ignores) and never leaves this process.
import express from 'express';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {loadCatalog,readRequest,askJev} from './jev.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(existsSync(path.join(root,'.env'))&&process.loadEnvFile)process.loadEnvFile(path.join(root,'.env'));

const PORT=Number(process.env.PORT)||4173;
const KEY=process.env.OPENROUTER_API_KEY||'';
const MODEL=process.env.JEV_MODEL||'typesafe/jev-1.13';
const catalog=loadCatalog(path.join(root,'js','genome.js'));

const app=express();
app.disable('x-powered-by');
// Behind a reverse proxy every request arrives from the proxy, so the per-address limit below would
// be shared by everyone. TRUST_PROXY (a hop count, "true", or a subnet list) restores the client IP.
const tp=process.env.TRUST_PROXY;
if(tp&&tp!=='false')app.set('trust proxy',tp==='true'?true:/^\d+$/.test(tp)?Number(tp):tp);
app.use((req,res,next)=>{
  res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'SAMEORIGIN'});
  next();
});

// ---- Jev ----
// A small per-address budget, so the endpoint cannot be used to spend the key: 12 asks a minute.
const RATE={windowMs:60000,max:12},hits=new Map();
function limited(ip){
  const now=Date.now(),h=(hits.get(ip)||[]).filter(t=>now-t<RATE.windowMs);
  h.push(now);hits.set(ip,h);
  if(hits.size>5000)for(const [k,v] of hits)if(!v.length||now-v[v.length-1]>RATE.windowMs)hits.delete(k);
  return h.length>RATE.max;
}
app.get('/api/jev',(req,res)=>res.json({ready:!!KEY,model:KEY?MODEL:null}));
app.post('/api/jev',express.json({limit:'16kb'}),async(req,res)=>{
  if(!KEY)return res.status(503).json({error:'The DJ is offline: the server has no OpenRouter key. Set OPENROUTER_API_KEY and restart.'});
  if(limited(req.ip))return res.status(429).json({error:'Easy: that is a lot of requests. Try again in a minute.'});
  let input;
  try{input=readRequest(req.body)}catch(e){return res.status(400).json({error:e.message})}
  try{res.json(await askJev(input,catalog,{key:KEY,model:MODEL}))}
  catch(e){
    console.error('[jev]',e.message);
    res.status(e.status||500).json({error:e.status?e.message:'The DJ hit a problem on the server.'});
  }
});
app.use('/api',(req,res)=>res.status(404).json({error:'no such endpoint'}));

// ---- the app ----
// Only the folders the page loads are served: never .env, the server code or node_modules.
// With a build (npm run build), the page comes from dist/: its scripts and stylesheet have content
// hashes in their names, so they are cached for a year and a deploy still loads the new code at once,
// because index.html itself is never cached. Without a build, the source files are served as they are.
const dist=path.join(root,'dist');
const built=existsSync(path.join(dist,'index.html'));
const opts={dotfiles:'ignore',index:false,maxAge:0};
if(built)app.use('/static',express.static(path.join(dist,'static'),{dotfiles:'ignore',index:false,immutable:true,maxAge:'365d'}));
else for(const dir of ['js','css'])app.use('/'+dir,express.static(path.join(root,dir),opts));
app.use('/assets',express.static(path.join(root,'assets'),opts));
// root as an option: the dotfile check then applies only to 'index.html', not to the folders above
app.get('/',(req,res)=>{res.set('Cache-Control','no-cache');res.sendFile('index.html',{root:built?dist:root})});
// for search engines
const SITE=(process.env.PUBLIC_URL||'https://sequencer.sudo.la').replace(/\/+$/,'');
app.get('/robots.txt',(req,res)=>res.type('text/plain').send('User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: '+SITE+'/sitemap.xml\n'));
app.get('/sitemap.xml',(req,res)=>res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>'+SITE+'/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url></urlset>\n'));
app.use((req,res)=>res.status(404).send('Not found'));
// never send a stack trace to the browser
app.use((err,req,res,next)=>{
  console.error('[server]',err&&err.message);
  if(res.headersSent)return next(err);
  res.status(err.status||err.statusCode||500).send(err.expose?err.message:'Server error');
});

app.listen(PORT,()=>{
  console.log('Sudo Sequencer on http://localhost:'+PORT+(built?' · built (dist/)':' · source (no build)')+(KEY?' · Jev on '+MODEL:' · Jev offline (no OPENROUTER_API_KEY)'));
});
