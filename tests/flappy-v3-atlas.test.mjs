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

test('V3.1 both atlases implement anatomically restrained shoulder and delayed wrist motion',()=>{
  assert.equal(manifest.version,'3.1');
  assert.equal(manifest.motion.phaseIsContinuousOnTap,true);
  assert.equal(manifest.motion.closedLoop,true);
  for(const skin of ['warm','slate']){
    const xml=read('flappy/assets/v3/'+skin+'-flight.svg');
    const count=(name)=>(xml.match(new RegExp('data-joint="'+name+'"','g'))||[]).length;
    for(const joint of ['shoulder-near','shoulder-far','wrist-near','wrist-far']){
      assert.equal(count(joint),24,skin+' needs each joint for all 24 frames');
    }
    const angles=[...xml.matchAll(/data-joint="shoulder-near" data-angle="(-?[0-9.]+)"/g)].map(m=>Number(m[1]));
    const wristAngles=[...xml.matchAll(/data-joint="wrist-near" data-angle="(-?[0-9.]+)"/g)].map(m=>Number(m[1]));
    assert.equal(angles.length,24);assert.equal(wristAngles.length,24);
    const swing=Math.max(...angles)-Math.min(...angles);
    const wristSwing=Math.max(...wristAngles)-Math.min(...wristAngles);
    assert.ok(swing>=36 && swing<=48,skin+' sweep should be 36–48 degrees, got '+swing);
    assert.ok(wristSwing>=10 && wristSwing<=18,skin+' wrist should flex independently');
    assert.ok(Math.abs(angles[0]-angles.at(-1))<=7,'the animation must wrap with minimal shoulder jump');
    assert.ok(Math.abs(wristAngles[0]-wristAngles.at(-1))<=4,'the animation must wrap with minimal wrist jump');
    assert.equal((xml.match(/<g(?:\s|>)/g)||[]).length,(xml.match(/<\/g>/g)||[]).length,'wing groups must balance');
  }
});

test('V3.1 visual phase is decoupled from click-triggered physics',()=>{
  assert.match(html,/if\(!bird\.wingActive\)\{bird\.wingPhase=0/);
  assert.match(html,/else bird\.wingQueued=true/);
  assert.match(html,/bird\.wingPhase=nextPhase-1;bird\.wingQueued=false/);
  assert.match(html,/bird\.wingActive\?bird\.wingPhase\*ATLAS_COUNT/);
  assert.doesNotMatch(html,/bird\.wing=1;bird\.flapAge=0/,'old immediate reset would cause a frame snap');
});
