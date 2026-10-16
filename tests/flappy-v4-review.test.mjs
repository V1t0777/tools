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

test('V4 static comparison mirrors scene strip origin and Canvas solar anchor crops',()=>{
 assert.match(html,/\.layer\{[^}]*left:0;transform:none/);
 assert.match(html,/\.layer\.sky\{[^}]*left:89%/);
 assert.match(html,/\.warm \.layer\.sky\{transform:translateX\(-73\.125%\)\}/);
 assert.match(html,/\.slate \.layer\.sky\{transform:translateX\(-76\.875%\)\}/);
 assert.match(game,/anchor=birdSkin==='warm'\?1170:1230/);
 assert.match(game,/var sx=Math\.max\(0,Math\.min\(1600-sw,anchor-sw\*\.74\)\)/);
});

test('V4 native inputs are actual sibling selectors, not nested inside labels',()=>{
  const section=html.split('<section class="options"')[1]?.split('<div class="worlds">')[0];
  assert.ok(section,'missing native CSS controls section');
  assert.doesNotMatch(section,/<label[^>]*>\s*<input\b/,'a nested input cannot select a sibling world container');
  for(const id of ['s360','s390','s420','s320','guides','fog']){
    assert.match(section,new RegExp('<input[^>]*id="'+id+'"[^>]*>\\s*<label for="'+id+'">'));
    if(id!=='s360')assert.ok(html.includes('#'+id),'missing associated CSS input switch '+id); // s360 is the declared default aspect ratio
  }
  assert.match(html,/\.options>input\{position:absolute/);
  assert.match(html,/\.options>input:focus-visible\+label\{outline:/);
  assert.match(html,/#s390:checked~\.worlds \.frame\{aspect-ratio:390\/844\}/);
  assert.match(html,/#s420:checked~\.worlds \.frame\{aspect-ratio:420\/740\}/);
  assert.match(html,/#s320:checked~\.worlds \.frame\{aspect-ratio:320\/568\}/);
  assert.match(html,/#guides:checked~\.worlds \.guides\{display:block\}/);
  assert.match(html,/#fog:not\(:checked\)~\.worlds \.layer\.mist\{display:none\}/);
});

test('V4 screenshot target mode is viewport-accurate while regular review remains multi-world',()=>{
  for(const theme of ['warm','slate'])
    assert.match(html,new RegExp('<article class="world '+theme+'" id="'+theme+'">'));
  assert.match(html,/body:has\(\.world:target\) \.world:not\(:target\)\{display:none\}/);
  assert.match(html,/body:has\(\.world:target\) \.frame\{width:100vw;height:100dvh;aspect-ratio:auto/);
  assert.match(html,/body:has\(\.world:target\) header,/);
  assert.doesNotMatch(html,/<script\b/i);
});
