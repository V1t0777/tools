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
 assert.match(game,/var sx=Math\.max\(0,Math\.min\(1600-sw,anchor-sw\*\.89\)\)/);
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

test('V4 browser evidence shows actual repeating layer joins at mid-screen without script',()=>{
  for(const theme of ['warm','slate']){
    assert.match(html,new RegExp('id="'+theme+'-seam"'));
    const segment=html.split('id="'+theme+'-seam"')[1]?.split('</section>')[0];
    assert.ok(segment,'missing seam proof for '+theme);
    for(const layer of ['far','mid','mist','near']){
      const filename='./assets/v4/'+theme+'/'+layer+'.svg';
      assert.equal(segment.split('src="'+filename+'"').length-1,2,'each '+layer+' must appear as two joined copies');
    }
  }
  assert.match(html,/img\.first\{left:calc\(50% - 160dvh\)\}/);
  assert.match(html,/img\.second\{left:50%\}/);
  assert.match(html,/body:has\(\.seamworld:target\) \.seamworld:target\{display:block\}/);
  assert.match(html,/body:has\(\.seamworld:target\) \.options,/);
  assert.doesNotMatch(html,/<script\b/i);
  const workflow=read('.github/workflows/flappy-v4-art-qa.yml');
  assert.match(workflow,/for view in scene seam/);
  assert.match(workflow,/fragment="\$theme-seam"/);
  assert.match(workflow,/if \(scene_count,seam_count,pose_count,pilot_count,master_count\)!=\(8,8,12,2,1\)/);
  assert.match(workflow,/for phase in power recovery glide/);
  assert.match(workflow,/review-v4\.html#\$theme-\$phase/);
});


test('Alpha 23 authentic wing atlas reviewer and CSS-only pose hashes do not fake the hero',()=>{
 assert.match(html,/background-image:url\("\.\/assets\/v3\/warm-flight\.svg"\)/);
 assert.match(html,/\.slate \.bird\{background-image:url\("\.\/assets\/v3\/slate-flight\.svg"\)\}/);
 assert.match(html,/background-size:600% 400%/);
 assert.match(html,/#wing-rest:checked~\.worlds \.bird/);
 for(const theme of ['warm','slate']){
   for(const pose of ['power','recovery','glide'])
     assert.ok(html.includes('id="'+theme+'-'+pose+'"'));
 }
 assert.match(html,/body:has\(\.phase-anchor:target\) \.frame\{width:100vw;height:100dvh/);
 assert.match(html,/石柱仍为布局参考，不是正式 Canvas 材质/);
 assert.doesNotMatch(html,/\.bird:after\{|border-radius:50%;background:#c18e60/);
 assert.doesNotMatch(html,/<script\b/i);
});


test('Alpha 24 warm far painting is opt-in only in a no-script, draft art comparison route',()=>{
 assert.match(html,/id="paint-pilot"/);
 assert.match(html,/id="warm-pilot"/);
 assert.match(html,/class="layer far far-base" src="\.\/assets\/v4\/warm\/far\.svg"/);
 assert.match(html,/class="layer far far-pilot" src="\.\/assets\/v4\/pilot\/warm\/far\.svg"/);
 assert.match(html,/#warm-pilot:target~\.frame \.far-base\{display:none\}/);
 assert.match(html,/#warm-pilot:target~\.frame \.far-pilot\{display:block\}/);
 assert.match(html,/#paint-pilot:checked~\.worlds \.warm \.far-base\{display:none\}/);
 assert.match(html,/#paint-pilot:checked~\.worlds \.warm \.far-pilot\{display:block\}/);
 assert.doesNotMatch(game,/warm-pilot|far-master-pilot|pilot\/warm\/far/);
 assert.doesNotMatch(html,/<script\b/i);
});


test('Alpha 24 master/source target files remain isolated from the game by review hashes',()=>{
 const workflow=read('.github/workflows/flappy-v4-art-qa.yml');
 assert.match(workflow,/master-warm-far-3200x2000\.png/);
 assert.match(workflow,/--window-size="3200,2000"/);
 assert.match(html,/id="paint-pilot"/);
 assert.match(html,/id="warm-pilot"/);
 assert.doesNotMatch(game,/pilot\/warm\/far|warm-pilot|far-master-pilot/);
});
