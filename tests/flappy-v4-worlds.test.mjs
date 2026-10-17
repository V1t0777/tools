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
