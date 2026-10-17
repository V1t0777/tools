import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const read=(path)=>readFileSync(new URL(path,root),'utf8');
const html=read('flappy/index.html');
const files=['sky','far','mid','mist','near'];
const build=read('cloudflare-secure/build.sh');

test('V4 alpha 2 has two distinct five-layer self-hosted SVG worlds',()=>{
  for(const skin of ['warm','slate']){
    const manifest=JSON.parse(read('flappy/assets/v4/'+skin+'/manifest.json'));
    assert.match(manifest.status,/not-for-release/);
    assert.deepEqual(manifest.viewBox,[0,0,1600,1000]);
    assert.deepEqual(manifest.layers.map(l=>l.id),files);
    assert.ok(manifest.layers.every(l=>Number.isFinite(l.scrollFactor)));
    assert.equal(manifest.layers.find(l=>l.id==='sky').alpha,false);
    for(const name of files){
      const svg=read('flappy/assets/v4/'+skin+'/'+name+'.svg');
      assert.match(svg,/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      assert.match(svg,/viewBox="0 0 1600 1000"/);
      assert.match(svg,/<\/svg>$/);
      assert.doesNotMatch(svg,/<(?:script|foreignObject|image)\b/i);
      assert.doesNotMatch(svg,/\b(?:href|src)\s*=\s*["']https?:/i);
    }
    assert.match(read('flappy/assets/v4/'+skin+'/sky.svg'),/<rect width="1600" height="1000"/);
    assert.doesNotMatch(read('flappy/assets/v4/'+skin+'/far.svg'),/<rect width="1600" height="1000"/);
  }
  assert.notEqual(read('flappy/assets/v4/warm/far.svg'),read('flappy/assets/v4/slate/far.svg'));
  assert.notEqual(read('flappy/assets/v4/warm/sky.svg'),read('flappy/assets/v4/slate/sky.svg'));
});

test('V4 worlds use an atomic loader and block mid-flight scene changes',()=>{
  assert.match(html,/var cinematicWorlds=\{/);
  assert.match(html,/function preloadCinematicWorld\(skin\)/);
  assert.ok(html.includes("picture.src='./assets/v4/'+skin+'/'+id+'.svg'"));
  assert.match(html,/world\.remaining=CINEMATIC_LAYERS\.length/);
  assert.match(html,/if\(world\.remaining===0\)/);
  assert.match(html,/world\.status='failed'/);
  assert.match(html,/cinematicSession!==birdSkin\|\|!world\|\|world\.status!=='ready'/);
  assert.match(html,/if\(!drawCinematicWorld\(\)\)\{/);
  assert.match(html,/drawBackground\(\);\s*drawClouds\(\);\s*drawRidges\(\)/);
  assert.match(html,/cinematicSession=cinematicWorlds\[birdSkin\]\.status==='ready'\?birdSkin:null/);
  assert.match(html,/if\(!reduceMotion&&sceneryQuality!=='low'\)/);
  assert.match(html,/else if\(state==='running'\)flap\(\)/);
  assert.match(html,/function collides\(\)/);
  const script=html.split('<script>')[1]?.split('</script>')[0];
  assert.ok(script);
  new vm.Script(script);
});

test('V4 both art kits ship only through the Cloudflare secure build',()=>{
  const security=read('scripts/security-check.sh');
  for(const skin of ['warm','slate']){
    assert.ok(build.includes('cp flappy/assets/v4/'+skin+'/{sky,far,mid,mist,near}.svg'));
    for(const name of files)
      assert.ok(security.includes('dist-secure/flappy/assets/v4/'+skin+'/'+name+'.svg'));
  }
  assert.doesNotMatch(read('scripts/build-public.sh'),/cp .*flappy\//);
});

test('V4 seam smoke audit: terrain joins at matching elevation; mist stays within the repeating tile',()=>{
  for(const skin of ['warm','slate']){
    for(const id of ['far','mid','near']){
      const svg=read('flappy/assets/v4/'+skin+'/'+id+'.svg');
      const first=svg.match(/<path d="M0 (\d+)\b([^"]+)"/);
      assert.ok(first,skin+' '+id+' missing left tile edge');
      const join=first[2].match(/(?:[LTS]|\s)1600 (\d+)\s+L1600 1000/);
      assert.ok(join,skin+' '+id+' missing explicit right tile edge');
      assert.equal(Number(first[1]),Number(join[1]),skin+' '+id+' edge altitudes differ');
    }
    const mist=read('flappy/assets/v4/'+skin+'/mist.svg');
    for(const ell of mist.matchAll(/<ellipse\b[^>]*cx="(\d+)"[^>]*rx="(\d+)"[^>]*>/g)){
      const x=Number(ell[1]),r=Number(ell[2]);
      assert.ok(x-r>=0&&x+r<=1600,skin+' fog ellipse crosses a non-matching tile edge');
    }
  }
});

test('V4 refined rocks and forest use clipped deterministic textures, with no GPU filters or active SVG features',()=>{
  for(const theme of ['warm','slate']){
    for(const layer of ['mid','near']){
      const svg=read('flappy/assets/v4/'+theme+'/'+layer+'.svg');
      assert.match(svg,new RegExp('<clipPath id="clip-rock-'+layer+'">'));
      assert.match(svg,new RegExp('<g clip-path="url\\(#clip-rock-'+layer+'\\)">'));
      assert.doesNotMatch(svg,/<(?:filter|script|animate|foreignObject|image)\b/i);
      assert.doesNotMatch(svg,/\bfeTurbulence\b/);
      const detail=(svg.match(/stroke-opacity=/g)||[]).length;
      assert.ok(detail>45,theme+'/'+layer+' requires material microdetails');
    }
  }
});

test('V4 atmosphere animation stays behind pipes and does not affect physical or scoring mechanics',()=>{
  const start=html.indexOf('  function drawCinematicWorld(){');
  const end=html.indexOf('  // V3:',start);
  assert.ok(start>0&&end>start);
  const body=html.slice(start,end);
  assert.match(body,/sceneryQuality!=='low'/);
  assert.match(body,/if\(sceneryQuality==='high'\)/);
  assert.match(body,/Math\.sin\(elapsed\*\.38\)/);
  assert.match(body,/ctx\.restore\(\)/);
  assert.match(html,/function observeSceneryFrame\(rawSeconds\)/);
  assert.match(html,/if\(sceneryWarmup<120\)/);
  assert.match(html,/scenerySlowFrames>=40/);
  assert.match(html,/drawCinematicWorld\(\)/);
  assert.match(html,/drawPipes\(\);/);
  assert.match(html,/drawGround\(\);/);
  assert.match(html,/function collides\(\)/);
});

test('V4 cinematic art pass keeps soft sky lighting and self-contained clipped far-mountain textures',()=>{
 for(const skin of ['warm','slate']){
   const sky=read('flappy/assets/v4/'+skin+'/sky.svg');
   const far=read('flappy/assets/v4/'+skin+'/far.svg');
   assert.match(sky,/<g id="sky-painterly-cloud-banks"/);
   assert.match(sky,/id="scattered-wisps"/);
   assert.match(sky,/<g id="diffused-(?:sunlight|moonlight)"/);
   const bank=sky.match(/<g id="sky-painterly-cloud-banks"[^>]*>([\s\S]*?)<\/g>/)?.[1];
   assert.ok(bank,'missing separate high-altitude cloud group');
   assert.equal((bank.match(/<path\b/g)||[]).length,16);
   assert.match(far,/<clipPath id="far-terrain-clip">/);
   assert.match(far,/<g id="far-rock-surface" clip-path="url\(#far-terrain-clip\)"/);
   assert.ok((far.match(/stroke-opacity=/g)||[]).length>=110);
   assert.doesNotMatch(sky+far,/<(?:script|animate|filter|foreignObject|image)\b/i);
   assert.doesNotMatch(sky+far,/\b(?:href|src)\s*=\s*["']https?:/i);
   assert.ok(Buffer.byteLength(sky,'utf8')<=6500,'keep per-scene sky render size bounded');
   assert.ok(Buffer.byteLength(far,'utf8')<=20000,'keep detailed far layer lightweight');
 }
});

test('V4 near canopy brushwork and crest facets remain clipped, lightweight and separate per world',()=>{
  for(const theme of ['warm','slate']){
    const near=read('flappy/assets/v4/'+theme+'/near.svg');
    const mid=read('flappy/assets/v4/'+theme+'/mid.svg');
    const treeCount=(near.match(/data-art-pass="pine-boughs-v1"/g)||[]).length;
    assert.ok(treeCount>=55&&treeCount<=65,'all '+theme+' canopy silhouettes get the independent bough pass');
    assert.match(near,/id="forest-broken-watercolor-glaze" clip-path="url\(#clip-rock-near\)"/);
    assert.match(mid,/id="mid-rock-watercolor-facets" clip-path="url\(#clip-rock-mid\)"/);
    assert.ok((mid.match(/fill-opacity=/g)||[]).length>=10);
    assert.ok(Buffer.byteLength(near,'utf8')<100_000,'near layer bytes must remain bounded');
    assert.ok(Buffer.byteLength(mid,'utf8')<24_000,'mid layer bytes must remain bounded');
    assert.doesNotMatch(near+mid,/<(?:filter|script|animate|foreignObject|image)\b/i);
  }
});

test('V4 repeating layers must not contain left-to-right paint gradients that create vertical tile seams',()=>{
  for(const theme of ['warm','slate']){
    for(const layer of ['far','mid','mist','near']){
      const source=read('flappy/assets/v4/'+theme+'/'+layer+'.svg');
      for(const [tag] of source.matchAll(/<linearGradient\b[^>]*>/g)){
        const x1=tag.match(/\bx1="([^"]+)"/)?.[1]??'0';
        const x2=tag.match(/\bx2="([^"]+)"/)?.[1]??'0';
        assert.equal(x1,x2,theme+'/'+layer+' has a non-seamless horizontal gradient: '+tag);
      }
    }
  }
});

test('V4 broad midrange pigment washes are visible-scale, clipped, theme-distinct and safe to tile',()=>{
 const captures=[];
 for(const theme of ['warm','slate']){
   const art=read('flappy/assets/v4/'+theme+'/mid.svg');
   const section=art.match(/<g id="mid-large-pigment-washes-v1" clip-path="url\(#clip-rock-mid\)">([\s\S]*?)<\/g>/);
   assert.ok(section,theme+' missing broad painted rock facets');
   const passes=section[1].match(/<path\b/g)||[];
   assert.ok(passes.length>=17,'need foreground-scale painting rather than tiny strokes');
   assert.ok((section[1].match(/fill-opacity=/g)||[]).length>=16);
   assert.ok(/stroke-width="9"/.test(section[1]),'require a large dry-brush edge');
   assert.doesNotMatch(section[1],/<(?:filter|image|script|animate|foreignObject)\b/i);
   assert.ok(Buffer.byteLength(art,'utf8')<24_000,'keep the original layer budget');
   captures.push(section[1]);
 }
 assert.notEqual(captures[0],captures[1],'two worlds need different mountains and pigments');
});

test('V4 near-scene painted canopy masses remain broad, softly layered, clipped and seamless at repeat edges',()=>{
 const before=[];
 for(const theme of ['warm','slate']){
   const svg=read('flappy/assets/v4/'+theme+'/near.svg');
   const section=svg.match(/<g id="near-broad-canopy-pigment-v1" clip-path="url\(#clip-rock-near\)">([\s\S]*?)<\/g>/);
   assert.ok(section,'missing large-scale painted canopy layer for '+theme);
   const content=section[1];
   const gouache=[...content.matchAll(/<path data-pigment="gouache-(\d+)"[^>]+\/>/g)];
   const edges=[...content.matchAll(/<path data-pigment="broken-edge-(\d+)"[^>]+\/>/g)];
   assert.equal(gouache.length,12,'need 12 original, legible broad color masses');
   assert.equal(edges.length,12,'need 12 broken dry-brush canopy edges');
   assert.ok(gouache.every(m=>/fill-opacity="0?\.[0-9]+"/.test(m[0])),'keep pigment washes translucent');
   assert.ok(edges.every(m=>/stroke-width="(?:[7-9]|1[0-3])"/.test(m[0])),'stroke texture must be visible at phone size');
   assert.ok(svg.indexOf('id="near-broad-canopy-pigment-v1"')<
             svg.indexOf('<g transform="translate('),'canopy wash must remain below silhouettes');
   assert.ok(/data-pigment="gouache-1" transform="translate\(60 0\)"/.test(content),
     'first broad wash needs safe padding from left tile edge');
   assert.doesNotMatch(content,/<(?:script|image|foreignObject|filter|animate)\b/i);
   assert.doesNotMatch(content,/\b(?:href|src)=/i);
   assert.ok(Buffer.byteLength(svg,'utf8')<100_000,'near scenery stays within decoded-art budget');
   before.push(content);
 }
 assert.notEqual(before[0],before[1],'warm and slate palettes should be hand-authored separately');
});



test('V4 distant mountain broad pigment passes are readable-scale, clipped, independent and seam-safe',()=>{
 const palettes=[];
 for(const theme of ['warm','slate']){
   const far=read('flappy/assets/v4/'+theme+'/far.svg');
   const section=far.match(/<g id="far-atmospheric-gouache-v1" clip-path="url\(#far-terrain-clip\)">([\s\S]*?)<\/g>/);
   assert.ok(section,theme+' needs a clipped far-ridge gouache pass');
   const washes=[...section[1].matchAll(/<path data-pigment="mountain-wash-(\d+)"[^>]+\/>/g)];
   const strokes=[...section[1].matchAll(/<path data-pigment="dry-ridge-(\d+)"[^>]+\/>/g)];
   assert.equal(washes.length,12,'distant broad washes, not scattered single-pixel noise');
   assert.equal(strokes.length,9,'visible-size broken-edge ridge accents');
   for(const [idx,wash] of washes.entries()){
     assert.match(wash[0],/fill-opacity="\.(?:1[0-9]|2[0-2])"/);
     assert.equal(Number(wash[1]),idx+1);
   }
   for(const [idx,stroke] of strokes.entries()){
     assert.match(stroke[0],/stroke-width="(?:9|10|11|12)"/);
     assert.equal(Number(stroke[1]),idx+1);
   }
   assert.ok(far.indexOf('id="far-atmospheric-gouache-v1"')<far.indexOf('<path d="M0 '+(theme==='warm'?'666':'682')),'nearer ridge must occlude distant gouache');
   assert.doesNotMatch(section[1],/<(?:filter|image|script|foreignObject|animate)\b|\b(?:href|src)=/i);
   assert.ok(Buffer.byteLength(far,'utf8')<20_000,'distant layer memory budget');
   palettes.push(section[1]);
 }
 assert.notEqual(palettes[0],palettes[1],'night art is separately painted, not palette-tinted copy');
});


test('V4 far-to-mid atmospheric color bridge uses clipped muted pigments with no tile-edge flashes',()=>{
 const palettes=[];
 for(const theme of ['warm','slate']){
   const mid=read('flappy/assets/v4/'+theme+'/mid.svg');
   const group=mid.match(/<g id="mid-far-light-bridge-v1" clip-path="url\(#clip-rock-mid\)">([\s\S]*?)<\/g>/);
   assert.ok(group,theme+' lacks the far-to-mid light bridge');
   const glazes=[...group[1].matchAll(/<path data-bridge="glaze-(\d+)"[^>]*\/>/g)];
   const edges=[...group[1].matchAll(/<path data-bridge="dry-light-(\d+)"[^>]*\/>/g)];
   assert.equal(glazes.length,7,'seven coherent source-scale light passes');
   assert.equal(edges.length,4,'four broad low-contrast dry edges');
   for(const [idx,entry] of glazes.entries()){
     assert.equal(Number(entry[1]),idx+1);
     assert.match(entry[0],/fill-opacity="\.(?:1[0-4])"/);
   }
   for(const [idx,entry] of edges.entries()){
     assert.equal(Number(entry[1]),idx+1);
     assert.match(entry[0],/stroke-width="(?:10|11|12)"/);
   }
   assert.ok(mid.indexOf('mid-far-light-bridge-v1')<mid.indexOf('mid-rock-watercolor-facets'),
     'lighting bridge belongs beneath detailed marks');
   assert.doesNotMatch(group[1],/<(?:script|filter|animate|foreignObject|image)\b|\b(?:href|src)=/i);
   assert.ok(Buffer.byteLength(mid,'utf8')<24_000,'retain mobile mid-layer budget');
   assert.ok(!/<path[^>]+d="M(?:0|1600) /.test(group[1]),
     'new light is inset rather than an edge-discontinuous shape');
   palettes.push(group[1]);
 }
 assert.notEqual(palettes[0],palettes[1],'twilight needs independent lunar lighting');
});


test('V4 Alpha 18 skyline directional atmospheric bounce stays subtle, original and CSP-safe',()=>{
 const samples=[];
 for(const theme of ['warm','slate']){
   const art=read('flappy/assets/v4/'+theme+'/sky.svg');
   const group=art.match(/<g id="sky-horizon-backscatter-v1">([\s\S]*?)<\/g>/);
   assert.ok(group,theme+' missing large-scale directional atmospheric pass');
   assert.match(art,/<radialGradient id="sky-horizon-glow-v1">/);
   const glows=[...group[1].matchAll(/<ellipse data-atmos="valley-glow-(\d+)"[^>]*\/>/g)];
   const shelves=[...group[1].matchAll(/<path data-atmos="haze-shelf-(\d+)"[^>]*\/>/g)];
   assert.equal(glows.length,2);
   assert.equal(shelves.length,3);
   assert.ok(glows.every((match,i)=>Number(match[1])===i+1));
   assert.ok(shelves.every((match,i)=>Number(match[1])===i+1));
   // Minimize clutter in the central bird lane: tint stays nearly invisible
   // while retaining a localized horizon field behind the mountain masks.
   for(const [tag] of shelves){
     const opacity=Number(tag.match(/stroke-opacity="([^"]+)"/)?.[1]);
     assert.ok(opacity>0&&opacity<=.1,'high-contrast cloud stroke could obscure gameplay');
     assert.match(tag,/stroke-width="(?:31|33|39|43|46|48)"/);
   }
   for(const [tag] of glows){
     const opacity=Number(tag.match(/opacity="([^"]+)"/)?.[1]);
     assert.ok(opacity>=.25&&opacity<=.6,'sky bloom must be controlled');
   }
   assert.ok(art.indexOf('id="sky-horizon-backscatter-v1"')<
     art.indexOf('id="sky-painterly-cloud-banks"'),'aerial glow goes below wisps');
   assert.ok(Buffer.byteLength(art,'utf8')<6500,'no large sky textures');
   assert.doesNotMatch(art,/<(?:filter|image|script|animate|foreignObject)\b/i);
   assert.doesNotMatch(art,/\b(?:href|src)\s*=\s*["']https?:/i);
   samples.push(group[1]);
 }
 assert.notEqual(samples[0],samples[1],'moonlight is not a tinted copy of warm sunlight');
});


test('V4 Alpha 19 feather silhouette and stone edge readability preserve the physical collision geometry',()=>{
 const atlases=[];
 for(const theme of ['warm','slate']){
   const svg=read('flappy/assets/v3/'+theme+'-flight.svg');
   assert.match(svg,/viewBox="0 0 1440 960"/);
   const frames=[...svg.matchAll(/data-frame="(\d+)"/g)].map(m=>Number(m[1]));
   assert.deepEqual(frames,Array.from({length:24},(_,i)=>i),'24 continuous wing frames retained');
   const contour=(svg.match(/fill="url\(#body-grad\)" stroke="[^"]+" stroke-opacity="\.52" stroke-width="2\.15"/g)||[]).length;
   const breast=(svg.match(/fill="url\(#breast-grad\)" stroke="[^"]+" stroke-opacity="\.17" stroke-width="1\.55"/g)||[]).length;
   assert.equal(contour,24,'all 24 body outlines share the same gentle treatment');
   assert.equal(breast,24,'all 24 breast panels share the same subtle edge');
   assert.doesNotMatch(svg,/<(?:filter|script|animate|foreignObject|image)\b/i);
   assert.doesNotMatch(svg,/\b(?:href|src)\s*=\s*["']https?:/i);
   assert.ok(Buffer.byteLength(svg,'utf8')<265_000,'no extra raster image or large sprite');
   atlases.push([...svg.matchAll(/data-joint="([^"]+)" data-angle="([^"]+)"/g)]
     .map(x=>x[1]+':'+x[2]));
 }
 assert.deepEqual(atlases[0],atlases[1],'warm and slate wing skeleton/phase must stay identical');
 const p=html.slice(html.indexOf('  function drawPipePart('),html.indexOf('  function drawPipes(){'));
 assert.ok(p.length>1000&&p.length<6000);
 assert.match(p,/ctx\.fillRect\(1\.2,1,Math\.min\(1\.6,w\*\.029\),Math\.max\(0,h-2\)\)/);
 assert.match(p,/ctx\.fillRect\(w-2\.8,1,1\.6,Math\.max\(0,h-2\)\)/);
 assert.match(p,/roundedRect\(\.65,capY\+\.65,w-1\.3,capH-1\.3,5\.3\);ctx\.stroke\(\)/);
 assert.match(html,/function collides\(\)/);
 assert.match(html,/var pw=pipeWidth\(\)/);
 assert.match(html,/function birdRadius\(\)\{return Math\.max\(13,W\*\.043\);\}/);
 assert.match(html,/function pipeWidth\(\)\{return clamp\(W\*\.155,48,68\);\}/);
});


test('Alpha 21 warm-near C1 seam keeps original ridgeline, transparent sky and repeat tangents',()=>{
 const svg=read('flappy/assets/v4/warm/near.svg');
 const ridge='M0 800 C24 800 34 790 52 785 C123 770 209 760 306 766 S492 739 599 753 S792 766 896 737 S1116 767 1227 744 S1482 750 1548 785 C1578 800 1590 800 1600 800';
 assert.equal(svg.split(ridge).length-1,3,
   'clip, opacity-filled terrain and top contour must reuse same periodic geometry');
 const clip=svg.match(/<clipPath id="clip-rock-near"><path d="([^"]+)"/);
 assert.ok(clip&&clip[1].startsWith(ridge),'terrain clip must match repeatable silhouette');
 assert.match(svg,/<path d="M0 800 C24 800 34 790 52 785[^"]+" fill="url\(#forestGrad\)" opacity="\.94"\/>/);
 assert.match(svg,/<path d="M0 800 C24 800 34 790 52 785[^"]+" fill="none" stroke="#b9c09c" stroke-opacity="\.16" stroke-width="3"\/>/);
 // First and last tangent control points share y=800 with the endpoint.
 // C1 seamlessness avoids a sharp kink without changing the source 1600x1000 bounds.
 const start=svg.match(/M0 (\d+) C(\d+) (\d+) (\d+) (\d+) (\d+) (\d+)/);
 const end=svg.match(/C(\d+) (\d+) (\d+) (\d+) 1600 (\d+) L1600 1000/);
 assert.ok(start&&end);
 assert.equal(Number(start[1]),800);
 assert.equal(Number(start[3]),800,'left tangent must be horizontal at the wrap');
 assert.equal(Number(end[4]),800,'right final cubic handle must be horizontal');
 assert.equal(Number(end[5]),800,'repeat endpoints share identical y');
 assert.match(svg,/viewBox="0 0 1600 1000"/);
 assert.ok(Buffer.byteLength(svg,'utf8')<93_000);
 assert.doesNotMatch(svg,/<(?:filter|script|animate|foreignObject|image)\b/i);
 const paired=svg.match(/<g id="near-wrapped-edge-pine-v1">([\s\S]*?)<\/g>/);
 assert.ok(paired,'warm repeating woodland should not leave a 90px treeless boundary');
 const left=paired[1].match(/<g data-repeat-edge="left" transform="translate\(0 800\) scale\(\.62\)">([\s\S]*?)<\/g>/);
 const right=paired[1].match(/<g data-repeat-edge="right" transform="translate\(1600 800\) scale\(\.62\)">([\s\S]*?)<\/g>/);
 assert.ok(left&&right,'full pine halves must be drawn across x=0 and x=1600');
 assert.equal(left[1],right[1],'each tile draws identical branches at the shared source boundary');
 assert.equal((left[1].match(/<path\b/g)||[]).length,3,'one broad pine + two quiet brush highlights');
 assert.ok(svg.indexOf('id="near-wrapped-edge-pine-v1"')<svg.indexOf('id="forest-broken-watercolor-glaze"'),
  'softest atmospheric wash remains in front of the new seam tree');
 assert.ok(Buffer.byteLength(svg,'utf8')<93_000);
 const other=read('flappy/assets/v4/slate/near.svg');
 assert.match(other,/M0 815 Q166 766 314 790/,'slate art retained for independent QA baseline');
});
