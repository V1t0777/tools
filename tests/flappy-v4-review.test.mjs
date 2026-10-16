import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('flappy/review-v4.html');
const game=read('flappy/index.html');
const build=read('cloudflare-secure/build.sh');
const sec=read('scripts/security-check.sh');

test('V4 QA preview supports identical warm/slate image layers and visual guide controls',()=>{
  assert.match(html,/id="warm"/);
  assert.match(html,/id="slate"/);
  for(const id of ['shape','scroll','playing','guides','fog']){
    assert.ok(html.includes('id="'+id+'"'),'missing QA control '+id);
  }
  for(const size of ['360,600','390,844','420,740','320,568'])
    assert.ok(html.includes('value="'+size+'"'),'missing device shape '+size);
  assert.ok(html.includes("'./assets/v4/'+theme+'/'+id+'.svg'"));
  assert.ok(html.includes("'./assets/v3/'+theme+'-flight.svg'"));
  assert.match(html,/Math\.min\(1600,W\*1000\/H\)/,'preserve round sun and moon');
  assert.match(html,/if\(guides\)paintGuides/);
  assert.match(html,/if\(layer\[0\]==='mist'&&!fog\)continue/);
});

test('V4 review page is self-contained, no tracking and valid inline JavaScript',()=>{
  const match=html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match,'missing review controller');
  assert.ok(match[1].includes("load('warm');load('slate')"),'review script must initialize both worlds');
  assert.doesNotMatch(html,/<script\s+src=/i);
  assert.doesNotMatch(html,/https?:\/\//);
  assert.doesNotMatch(html,/localStorage|ToolboxAuth|supabase|fetch\(/i);
  assert.match(html,/<meta name="robots" content="noindex,nofollow">/);
});

test('V4 QA is preview-only and explicitly blocked from final release',()=>{
  assert.match(build,/cp flappy\/review-v4\.html/);
  assert.match(sec,/dist-secure\/flappy\/review-v4\.html/);
  assert.doesNotMatch(read('scripts/build-public.sh'),/review-v4/);
  assert.match(read('flappy/assets/v4/ART_SPEC.md'),/NOT FOR RELEASE/);
});

test('V4 scenery renderer hides floating point tiling gaps on high-DPR displays',()=>{
  assert.match(game,/var overlap=\.75\/dpr/);
  assert.match(game,/tileWidth\+overlap,H/);
  assert.match(game,/var dx=\(\(scroll\*layer\.speed\+\(drift\|\|0\)\)\%tileWidth\+tileWidth\)\%tileWidth/);
});
