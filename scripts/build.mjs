// Production build: minified, content-hashed files in dist/, so every deploy busts the browser's
// cache for exactly what changed (and only that). Run with: npm run build
//   - the classic scripts, in their page order, as one minified file (they share global names, so
//     they are concatenated, not bundled)
//   - the 3D stage (ES modules plus three.js) bundled into one minified module
//   - the stylesheet, minified
// The server serves dist/ when it exists (index.html never cached, static/ cached for a year), and
// the source files when it does not, so npm start works without a build.
import {build,transform} from 'esbuild';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'dist'),stat=path.join(out,'static');
const read=f=>readFile(path.join(root,f),'utf8');
const hash=s=>createHash('sha256').update(s).digest('hex').slice(0,10);
const sizes=[];
async function emit(name,ext,code){
  const file=name+'.'+hash(code)+'.'+ext;
  await writeFile(path.join(stat,file),code);
  sizes.push([file,code.length]);
  return 'static/'+file;
}

await rm(out,{recursive:true,force:true});
await mkdir(stat,{recursive:true});
let html=await read('index.html');

// 1. classic scripts, in page order
const classic=[...html.matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map(m=>m[1]);
if(!classic.length)throw new Error('no classic scripts found in index.html');
const joined=(await Promise.all(classic.map(read))).map((s,i)=>';/* '+classic[i]+' */\n'+s+'\n').join('');
const app=await transform(joined,{minify:true,target:'es2022',legalComments:'none'});
const appUrl=await emit('app','js',app.code);

// 2. the stage and everything it imports, three.js included (no import map needed any more)
const mod=await build({entryPoints:[path.join(root,'js/stage.js')],bundle:true,format:'esm',minify:true,write:false,
  target:'es2022',legalComments:'none',absWorkingDir:root,alias:{three:'./js/vendor/three.module.js'},logLevel:'warning'});
const stageUrl=await emit('stage','js',mod.outputFiles[0].text);

// 3. the stylesheet
const css=await transform(await read('css/app.css'),{loader:'css',minify:true});
const cssUrl=await emit('app','css',css.code);

// 4. the page, pointing at the hashed files
let first=true;
html=html
  .replace(/<script src="js\/[^"]+"><\/script>\n?/g,()=>{if(!first)return '';first=false;return '<script src="'+appUrl+'"></script>\n'})
  .replace(/<script type="importmap">[^<]*<\/script>\n?/,'')
  .replace('<script type="module" src="js/stage.js"></script>','<script type="module" src="'+stageUrl+'"></script>')
  .replace('<link rel="stylesheet" href="css/app.css">','<link rel="stylesheet" href="'+cssUrl+'">');
for(const needle of ['src="js/','href="css/app.css"','type="importmap"'])
  if(html.includes(needle))throw new Error('index.html still references '+needle);
await writeFile(path.join(out,'index.html'),html);

for(const [f,n] of sizes)console.log((n/1024).toFixed(0).padStart(6)+' KB  dist/static/'+f);
console.log('built dist/index.html');
