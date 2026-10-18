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
  assert.match(workflow,/if \(scene_count,seam_count,pose_count,pilot_count,master_count,pilot_seam_count,mid_count,stack_count,mid_seam_count,mist_count,atmo_count,mist_seam_count,sky_count,light_count,near_count,full_count,near_seam_count,alpha29_ref_count,alpha31_raster_count,alpha31_raster_seam_count,alpha32_raster_count,alpha32_raster_seam_count,alpha33_raster_count,alpha33_raster_seam_count,alpha34_raster_count,alpha34_raster_seam_count,alpha35_raster_count,alpha35_raster_seam_count,alpha36_raster_count,alpha36_raster_seam_count,alpha37_mid_count,alpha37_mid_seam_count,alpha37_world_count\)!=\(8,8,12,4,10,2,4,4,2,4,4,2,4,4,4,4,2,4,4,2,4,2,4,2,4,2,2,1,4,2,4,2,2\)/);
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


test('Alpha 25 second world has true opt-in independently painted far and a two-copy seam proof',()=>{
 assert.match(html,/class="layer far far-base" src="\.\/assets\/v4\/slate\/far\.svg"/);
 assert.match(html,/class="layer far far-pilot" src="\.\/assets\/v4\/pilot\/slate\/far\.svg"/);
 assert.match(html,/id="slate-pilot"/);
 assert.match(html,/#slate-pilot:target~\.frame \.far-base\{display:none\}/);
 assert.match(html,/#slate-pilot:target~\.frame \.far-pilot\{display:block\}/);
 assert.match(html,/#paint-pilot:checked~\.worlds \.slate \.far-base\{display:none\}/);
 assert.match(html,/#paint-pilot:checked~\.worlds \.slate \.far-pilot\{display:block\}/);
 for(const theme of ['warm','slate']){
   const section=html.split('id="'+theme+'-pilot-seam"')[1]?.split('</section>')[0];
   assert.ok(section,'pilot painterly seam reviewer missing for '+theme);
   assert.equal(section.split('src="./assets/v4/pilot/'+theme+'/far.svg"').length-1,2,
     'identical original painted far must be repeated twice with no extra overlay');
 }
 assert.doesNotMatch(html,/<script\b/i);
 assert.doesNotMatch(game,/slate-pilot|pilot\/slate\/far|far-master-pilot/);
});


test('Alpha 26 two middle-distance originals toggle independently or paired in no-script reviewer',()=>{
 assert.match(html,/id="paint-mid-pilot"/);
 assert.match(html,/#paint-mid-pilot:checked~\.worlds \.world \.mid-base\{display:none\}/);
 assert.match(html,/#paint-mid-pilot:checked~\.worlds \.world \.mid-pilot\{display:block\}/);
 for(const theme of ['warm','slate']){
   assert.match(html,new RegExp('id="'+theme+'-mid-pilot"'));
   assert.match(html,new RegExp('id="'+theme+'-stack-pilot"'));
   assert.match(html,new RegExp('class="layer mid mid-base" src="\\./assets/v4/'+theme+'/mid\\.svg"'));
   assert.match(html,new RegExp('class="layer mid mid-pilot" src="\\./assets/v4/pilot/'+theme+'/mid\\.svg"'));
   const section=html.split('id="'+theme+'-mid-pilot-seam"')[1]?.split('</section>')[0];
   assert.ok(section,'Each mid painting needs an isolated repeating-tile comparison');
   assert.equal(section.split('src="./assets/v4/pilot/'+theme+'/mid.svg"').length-1,2);
 }
 assert.match(html,/#warm-mid-pilot:target~\.frame \.mid-base/);
 assert.match(html,/#slate-stack-pilot:target~\.frame \.far-pilot/);
 assert.doesNotMatch(html,/<script\b/i);
 assert.doesNotMatch(game,/pilot\/warm\/mid|pilot\/slate\/mid|stack-pilot/);
});


test('Alpha 27 authentic valley fog isolates original vs pilot and far+mid+mist compound',()=>{
 assert.match(html,/id="paint-mist-pilot"/);
 assert.match(html,/#paint-mist-pilot:checked~\.worlds \.world \.mist-base\{display:none\}/);
 for(const theme of ['warm','slate']){
   assert.match(html,new RegExp('id="'+theme+'-mist-pilot"'));
   assert.match(html,new RegExp('id="'+theme+'-atmo-pilot"'));
   assert.match(html,new RegExp('class="layer mist mist-base" src="\\./assets/v4/'+theme+'/mist\\.svg"'));
   assert.match(html,new RegExp('class="layer mist mist-pilot" src="\\./assets/v4/pilot/'+theme+'/mist\\.svg"'));
   const section=html.split('id="'+theme+'-mist-pilot-seam"')[1]?.split('</section>')[0];
   assert.ok(section,'Original mist must have a repeat join proof');
   assert.equal(section.split('src="./assets/v4/pilot/'+theme+'/mist.svg"').length-1,2);
 }
 assert.match(html,/#warm-atmo-pilot:target~\.frame \.mist-base/);
 assert.match(html,/#slate-atmo-pilot:target~\.frame \.far-pilot/);
 assert.doesNotMatch(html,/<script\b/i);
 assert.doesNotMatch(game,/pilot\/warm\/mist|pilot\/slate\/mist|atmo-pilot/);
});


test('Alpha 28 sky and four-layer luminous composite are opt-in with the real atlas',()=>{
 assert.match(html,/id="paint-sky-pilot"/);
 assert.match(html,/#paint-sky-pilot:checked~\.worlds \.world \.sky-base\{display:none\}/);
 assert.match(html,/#paint-sky-pilot:checked~\.worlds \.world \.sky-pilot\{display:block\}/);
 for(const th of ['warm','slate']){
   assert.match(html,new RegExp('id="'+th+'-sky-pilot"'));
   assert.match(html,new RegExp('id="'+th+'-light-pilot"'));
   assert.match(html,new RegExp('class="layer sky sky-base" src="\\./assets/v4/'+th+'/sky\\.svg"'));
   assert.match(html,new RegExp('class="layer sky sky-pilot" src="\\./assets/v4/pilot/'+th+'/sky\\.svg"'));
 }
 assert.match(html,/#warm-light-pilot:target~\.frame \.sky-base/);
 assert.match(html,/#slate-light-pilot:target~\.frame \.far-pilot/);
 assert.match(html,/\.warm \.layer\.sky\{transform:translateX\(-73\.125%\)\}/);
 assert.match(html,/\.slate \.layer\.sky\{transform:translateX\(-76\.875%\)\}/);
 assert.match(html,/background-image:url\("\.\/assets\/v3\/warm-flight\.svg"\)/);
 assert.doesNotMatch(html,/<script\b/i);
 assert.doesNotMatch(game,/pilot\/warm\/sky|pilot\/slate\/sky|sky-master-pilot/);
});


test('Alpha 29 authentic warm and slate forest near artwork is independently reviewable in five-layer source stack',()=>{
 assert.match(html,/id="paint-near-pilot"/);
 assert.match(html,/#paint-near-pilot:checked~\.worlds \.world \.near-base\{display:none\}/);
 assert.match(html,/#paint-near-pilot:checked~\.worlds \.world \.near-pilot\{display:block\}/);
 for(const theme of ['warm','slate']){
   assert.match(html,new RegExp('id="'+theme+'-near-pilot"'));
   assert.match(html,new RegExp('id="'+theme+'-full-pilot"'));
   assert.match(html,new RegExp('class="layer near near-base" src="\\./assets/v4/'+theme+'/near\\.svg"'));
   assert.match(html,new RegExp('class="layer near near-pilot" src="\\./assets/v4/pilot/'+theme+'/near\\.svg"'));
   const section=html.split('id="'+theme+'-near-pilot-seam"')[1]?.split('</section>')[0];
   assert.ok(section,'Near repeating trees require a separate tile seam QA route');
   assert.equal(section.split('src="./assets/v4/pilot/'+theme+'/near.svg"').length-1,2);
 }
 assert.match(html,/#warm-full-pilot:target~\.frame \.near-base/);
 assert.match(html,/#slate-full-pilot:target~\.frame \.near-pilot/);
 assert.doesNotMatch(html,/<script\b/i);
 assert.doesNotMatch(game,/pilot\/warm\/near|pilot\/slate\/near|full-pilot/);
});


test('Alpha 30 frozen original near art A/B is CSS-only, transparent to real game assets',()=>{
 assert.match(html,/\.layer\.near-alpha29\{display:none\}/);
 assert.match(html,/#warm-near-alpha29:target~\.frame \.near-base/);
 assert.match(html,/#slate-near-alpha29:target~\.frame \.near-alpha29/);
 for(const theme of ['warm','slate']){
   assert.match(html,new RegExp('id="'+theme+'-near-alpha29"'));
   assert.match(html,new RegExp('src="\\./assets/v4/pilot/'+theme+'/near-alpha29\\.svg"'));
 }
 assert.doesNotMatch(game,/near-alpha29|full-pilot/);
 assert.doesNotMatch(html,/<script\b/i);
});


test('Alpha31 raster proof routes are opt-in and no runtime PNG injection',()=>{
 assert.match(html,/#warm-raster-alpha31:target~\.frame \.near-base/);
 assert.match(html,/#slate-raster-alpha31:target~\.frame \.near-raster-alpha31/);
 assert.match(html,/\.layer\.near-raster-alpha31\{display:none;aspect-ratio:8\/5/);
 for(const th of ['warm','slate']){
  assert.match(html,new RegExp('id="'+th+'-raster-alpha31"'));
  assert.match(html,new RegExp('id="'+th+'-raster-alpha31-seam"'));
  assert.match(html,new RegExp('near-raster-alpha31\\.png'));
 }
 assert.doesNotMatch(html,/<script\b/i);
 assert.doesNotMatch(game,/near-raster-alpha31|raster-pigment/);
});

test('Alpha32 directed RGBA study uses separate QA routes, no game injection',()=>{
 const workflow=read('.github/workflows/flappy-v4-art-qa.yml');
 assert.match(workflow,/flappy-v4-directional-paint\.py/);
 assert.match(workflow,/alpha32-directional-paint-metrics\.json/);
 assert.match(workflow,/alpha32-raster-seam/);
 assert.match(html,/#warm-raster-alpha32:target~\.frame \.near-base/);
 assert.match(html,/#slate-raster-alpha32:target~\.frame \.near-raster-alpha32/);
 for(const theme of ['warm','slate']){
   assert.ok(html.includes('id="'+theme+'-raster-alpha32"'));
   assert.ok(html.includes('id="'+theme+'-raster-alpha32-seam"'));
   assert.ok(html.includes('near-raster-alpha32.png'));
 }
 assert.doesNotMatch(game,/near-raster-alpha32|directional-paint/);
 assert.doesNotMatch(html,/<script\b/i);
});

test('Alpha33 corrects two-world Alpha32 preview missing/duplicate layers',()=>{
 const workflow=read('.github/workflows/flappy-v4-art-qa.yml');
 for(const theme of ['warm','slate']){
   const article=html.split('<article class="world '+theme+'"')[1].split('</article>')[0];
   assert.ok(article,'missing theme article '+theme);
   for(const stage of [31,32,33]){
     const needle='class="layer near near-raster-alpha'+stage+'"';
     assert.equal(article.split(needle).length-1,1,'exactly one '+theme+' alpha'+stage+' visual layer');
   }
   assert.ok(article.includes('id="'+theme+'-raster-alpha33"'));
   assert.ok(html.includes('id="'+theme+'-raster-alpha33-seam"'));
   assert.match(html,new RegExp('\\.'+theme+' \\.near-raster-alpha33\\{background-image:url'));
 }
 assert.match(workflow,/flappy-v4-local-material\.py/);
 assert.match(workflow,/alpha33-raster-seam-\$theme-320x568/);
 assert.match(workflow,/alpha33-local-material-metrics\.json/);
 assert.match(workflow,/Alpha 37 expected 127 static art screenshots/);
 assert.doesNotMatch(html,/<script\b/i);
 assert.doesNotMatch(game,/near-raster-alpha33|local-material/);
});

test('Alpha34 A/B shows exactly one current and historical PNG per scene',()=>{
 const workflow=read('.github/workflows/flappy-v4-art-qa.yml');
 for(const th of ['warm','slate']){
  const block=html.split('<article class="world '+th+'"')[1].split('</article>')[0];
  for(const phase of [31,32,33,34]){
   const needle='class="layer near near-raster-alpha'+phase+'"';
   assert.equal(block.split(needle).length-1,1,th+' phase '+phase);
  }
  assert.ok(block.includes('id="'+th+'-raster-alpha34"'));
  assert.ok(html.includes('id="'+th+'-raster-alpha34-seam"'));
  assert.ok(html.includes('near-raster-alpha34.png'));
 }
 assert.match(workflow,/Alpha 37 expected 127 static art screenshots/);
 assert.doesNotMatch(html,/<script\b/i);
 assert.doesNotMatch(game,/near-raster-alpha34/);
});

test('Alpha35 draft reviewer displays exactly one slate image and leaves warm unchanged',()=>{
 const workflow=read('.github/workflows/flappy-v4-art-qa.yml');
 const warm=html.split('<article class="world warm"')[1].split('</article>')[0];
 const slate=html.split('<article class="world slate"')[1].split('</article>')[0];
 for(const n of [31,32,33,34]){
  assert.equal(warm.split('class="layer near near-raster-alpha'+n+'"').length-1,1);
  assert.equal(slate.split('class="layer near near-raster-alpha'+n+'"').length-1,1);
 }
 assert.equal(warm.split('class="layer near near-raster-alpha35"').length-1,0);
 assert.equal(slate.split('class="layer near near-raster-alpha35"').length-1,1);
 assert.ok(slate.includes('id="slate-raster-alpha35"'));
 assert.ok(html.includes('id="slate-raster-alpha35-seam"'));
 assert.match(html,/#slate-raster-alpha35:target~\.frame \.near-raster-alpha35\{display:block\}/);
 assert.match(workflow,/Alpha 37 expected 127 static art screenshots/);
 assert.doesNotMatch(html,/<script\b/i);
 assert.doesNotMatch(game,/near-raster-alpha35|conifer-structure/);
});

test('Alpha36 scenes use one isolated outline raster each with both source repeat proofs',()=>{
 const workflow=read('.github/workflows/flappy-v4-art-qa.yml');
 for(const th of ['warm','slate']){
  const article=html.split('<article class="world '+th+'"')[1].split('</article>')[0];
  assert.equal(article.split('class="layer near near-raster-alpha36"').length-1,1);
  assert.ok(article.includes('id="'+th+'-raster-alpha36"'));
  assert.ok(html.includes('id="'+th+'-raster-alpha36-seam"'));
  assert.match(html,new RegExp('\\.'+th+' \\.near-raster-alpha36\\{background-image:url'));
 }
 assert.match(workflow,/Alpha 37 expected 127 static art screenshots/);
 assert.doesNotMatch(html,/<script\b/i);
 assert.doesNotMatch(game,/near-raster-alpha36/);
});

test('Alpha37 reviewer provides coherent independent natural mountain A/B and two true joins',()=>{
 const workflow=read('.github/workflows/flappy-v4-art-qa.yml');
 for(const theme of ['warm','slate']){
  const scene=html.split('<article class="world '+theme+'"')[1].split('</article>')[0];
  assert.equal(scene.split('class="layer mid mid-alpha37"').length-1,1);
  assert.ok(scene.includes('id="'+theme+'-mid-alpha37"'));
  assert.ok(scene.includes('id="'+theme+'-world-alpha37"'));
  assert.ok(html.includes('id="'+theme+'-mid-alpha37-seam"'));
  assert.match(html,new RegExp('\\.'+theme+' \\.mid-alpha37\\{background-image:url'));
 }
 assert.match(workflow,/Alpha 37 expected 127 static art screenshots/);
 assert.doesNotMatch(html,/<script\b/i);
 assert.doesNotMatch(game,/mid-raster-alpha37/);
});
