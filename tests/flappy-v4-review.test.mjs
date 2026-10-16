import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('flappy/review-v4.html');
const game=read('flappy/index.html');
const build=read('cloudflare-secure/build.sh');
const sec=read('scripts/security-check.sh');

test('V4 static review renders all five original art layers for both worlds',()=>{
 for(const theme of ['warm','slate']){
  assert.ok(html.includes('class="world '+theme+'"'));
  for(const layer of ['sky','far','mid','mist','near'])
   assert.ok(html.includes('src="./assets/v4/'+theme+'/'+layer+'.svg"'),'missing '+theme+'/'+layer);
 }
 for(const id of ['s360','s390','s420','s320','guides','fog'])
  assert.ok(html.includes('id="'+id+'"'),'missing QA control '+id);
 assert.match(html,/class="worlds"/);
 assert.match(html,/#s390:checked~\.worlds \.frame/);
 assert.match(html,/#guides:checked~\.worlds \.guides/);
 assert.match(html,/#fog:not\(:checked\)~\.worlds \.layer\.mist/);
});

test('V4 review page contains no executable JavaScript, external networking or storage',()=>{
 assert.doesNotMatch(html,/<script\b/i);
 assert.doesNotMatch(html,/<iframe\b/i);
 assert.doesNotMatch(html,/\bon(?:error|load|click)\s*=/i);
 assert.doesNotMatch(html,/src="https?:/i);
 assert.doesNotMatch(html,/localStorage|ToolboxAuth|supabase|fetch\(/i);
 assert.match(html,/<meta name="robots" content="noindex,nofollow">/);
});

test('V4 reviewer stays in the draft secure build, never public Pages',()=>{
 assert.match(build,/cp flappy\/review-v4\.html/);
 assert.match(sec,/dist-secure\/flappy\/review-v4\.html/);
 assert.doesNotMatch(read('scripts/build-public.sh'),/review-v4/);
 assert.match(read('flappy/assets/v4/ART_SPEC.md'),/NOT FOR RELEASE/);
});

test('V4 rendering uses a minimal high-DPR tile overlap, including atmosphere drift',()=>{
 assert.match(game,/var overlap=\.75\/dpr/);
 assert.match(game,/tileWidth\+overlap,H/);
 assert.match(game,/var dx=\(\(scroll\*layer\.speed\+\(drift\|\|0\)\)\%tileWidth\+tileWidth\)\%tileWidth/);
});
