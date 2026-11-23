// The runtime image is trimmed to what the server needs. This keeps it from dropping a file the
// server reads at startup (it once dropped js/genome.js, and the container crashed on boot).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const docker=readFileSync(new URL('../Dockerfile',import.meta.url),'utf8');
const runtime=docker.slice(docker.lastIndexOf('\nFROM '));          // the final stage only
const index=readFileSync(new URL('../server/index.js',import.meta.url),'utf8');

test('the runtime image copies every file the server reads at startup',()=>{
  // files the server opens by path: path.join(root,'a','b.js') -> a/b.js
  const read=[...index.matchAll(/path\.join\(root,((?:'[^']+',?)+)\)/g)].map(m=>m[1].replace(/'/g,'').split(',').filter(Boolean).join('/'));
  const files=read.filter(f=>/\.[a-z]+$/.test(f)&&f!=='.env');
  assert.ok(files.includes('js/genome.js'));
  for(const f of files)assert.match(runtime,new RegExp('COPY\\s+(--from=\\S+\\s+)?\\S*'+f.split('/')[0]),'the runtime stage does not copy '+f);
  assert.match(runtime,/COPY server \.\/server/);
  assert.match(runtime,/COPY --from=build \/src\/dist \.\/dist/);
});
