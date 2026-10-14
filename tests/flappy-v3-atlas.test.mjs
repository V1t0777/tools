import {readFileSync,existsSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const read=(p)=>readFileSync(new URL(p,root),'utf8');
const manifest=JSON.parse(read('flappy/assets/v3/manifest.json'));
const html=read('flappy/index.html');
const build=read('cloudflare-secure/build.sh');

test('V3 transparent atlas contract: fixed 24-frame grid and same silhouette rig',()=>{
  assert.equal(manifest.frames,24);
  assert.equal(manifest.columns*manifest.rows,manifest.frames);
  assert.deepEqual(manifest.cell,{width:240,height:240});
  for(const skin of ['warm','slate']){
    const xml=read('flappy/assets/v3/'+skin+'-flight.svg');
    assert.match(xml,/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(xml,/width="1440" height="960"/);
    assert.doesNotMatch(xml,/<(?:script|image|foreignObject)\b/i,'atlas should not load scripts, remote images or active content');
    assert.doesNotMatch(xml,/(?:href|url)\s*=\s*["']https?:/i,'atlas should be self-contained');
    assert.equal((xml.match(/data-frame="\d+"/g)||[]).length,24);
    for(let i=0;i<24;i++){
      assert.ok(xml.includes('data-frame="'+i+'"'),'missing pose '+i);
    }
    assert.match(xml,/eye-grad/);
    assert.match(xml,/wing-grad/);
    assert.match(xml,/breast-grad/);
  }
});

test('game loads local atlas, renders from Canvas and preserves vector fallback',()=>{
  assert.match(html,/function ensureFlightAtlas\(skin\)/);
  assert.match(html,/if\(typeof Image/);
  assert.match(html,/typeof Image!=='function'/);
  assert.match(html,/function drawFlightAtlas\(now\)/);
  assert.match(html,/if\(drawFlightAtlas\(now\)\)return/);
  assert.match(html,/ATLAS_FRAME=240,ATLAS_COLS=6,ATLAS_COUNT=24/);
  assert.match(html,/function birdRadius\(\)/);
  assert.match(html,/function collides\(\)/);
  assert.match(html,/zhaoFlappyBest\.v1/);
});

test('production assets are included only in Cloudflare secure artifact',()=>{
  assert.match(build,/cp flappy\/assets\/v3\/warm-flight\.svg flappy\/assets\/v3\/slate-flight\.svg/);
  const publicBuild=read('scripts/build-public.sh');
  assert.doesNotMatch(publicBuild,/cp .*flappy\//);
  assert.match(read('scripts/security-check.sh'),/dist-secure\/flappy\/assets\/v3\/warm-flight\.svg/);
});
