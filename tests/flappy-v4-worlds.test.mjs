import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const read=(path)=>readFileSync(new URL(path,root),'utf8');
const html=read('flappy/index.html');
const manifest=JSON.parse(read('flappy/assets/v4/warm/manifest.json'));
const files=['sky','far','mid','mist','near'];
const build=read('cloudflare-secure/build.sh');

test('V4 alpha 1 has five genuine, independent self-hosted SVG art layers',()=>{
  assert.equal(manifest.status,'technical-sample-not-for-release');
  assert.deepEqual(manifest.viewBox,[0,0,1600,1000]);
  assert.deepEqual(manifest.layers.map(layer=>layer.id),files);
  assert.ok(manifest.layers.every(layer=>Number.isFinite(layer.scrollFactor)));
  assert.equal(manifest.layers.find(l=>l.id==='sky').alpha,false);
  for(const name of files){
    const svg=read('flappy/assets/v4/warm/'+name+'.svg');
    assert.match(svg,/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg,/viewBox="0 0 1600 1000"/);
    assert.match(svg,/<\/svg>$/);
    assert.doesNotMatch(svg,/<(?:script|foreignObject|image)\b/i);
    assert.doesNotMatch(svg,/\b(?:href|src)\s*=\s*["']https?:/i);
  }
  assert.match(read('flappy/assets/v4/warm/sky.svg'),/<rect width="1600" height="1000"/);
  assert.doesNotMatch(read('flappy/assets/v4/warm/far.svg'),/<rect width="1600" height="1000"/);
});

test('V4 rendering atomically activates the sample only after all layers load',()=>{
  assert.match(html,/cinematicWorld\.remaining=CINEMATIC_LAYERS\.length/);
  assert.match(html,/if\(cinematicWorld\.remaining===0\)/);
  assert.match(html,/cinematicWorld\.status='failed'/);
  assert.match(html,/cinematicWorld\.status!=='ready'\)return false/);
  assert.match(html,/if\(!drawCinematicWarm\(\)\)\{/);
  assert.match(html,/drawBackground\(\);\s*drawClouds\(\);\s*drawRidges\(\)/);
  assert.match(html,/cinematicSession=birdSkin==='warm'&&cinematicWorld\.status==='ready'/);
  assert.match(html,/if\(!reduceMotion\)drawCinematicLayer\(CINEMATIC_LAYERS\[3\]\)/);
  assert.match(html,/else if\(state==='running'\)flap\(\)/);
  assert.match(html,/function collides\(\)/);
  const script=html.split('<script>')[1]?.split('</script>')[0];
  assert.ok(script);
  new vm.Script(script);
});

test('V4 scenery is isolated in Cloudflare build, not the public GitHub Pages output',()=>{
  assert.match(build,/cp flappy\/assets\/v4\/warm\/\{sky,far,mid,mist,near\}\.svg/);
  const security=read('scripts/security-check.sh');
  for(const name of files)assert.ok(security.includes('dist-secure/flappy/assets/v4/warm/'+name+'.svg'));
  assert.doesNotMatch(read('scripts/build-public.sh'),/cp .*flappy\//);
});
