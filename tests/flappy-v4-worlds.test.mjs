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
