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
  assert.match(html,/if\(!reduceMotion\)drawCinematicLayer\(CINEMATIC_LAYERS\[3\],world\)/);
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
