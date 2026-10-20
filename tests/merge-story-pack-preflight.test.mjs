import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState} from '../merge/engine.mjs';
import {MAX_STORY_PACKS,createEmptyStoryProgress,registerStoryPack,validateStoryProgress} from '../merge/mode-boundaries.mjs';
import {previewStoryPackAvailability} from '../merge/story-pack-preflight.mjs';

const withDlc=()=>registerStoryPack(registerStoryPack(createEmptyStoryProgress(),'core'),'dlc.mist-harbor');

test('P2.14 installed story packs produce a frozen deterministic read-only report',()=>{
  const save=withDlc(),before=structuredClone(save);
  const ids=['dlc.mist-harbor','core'];
  const report=previewStoryPackAvailability(save,ids);
  assert.deepEqual(report,{
    mode:'story',projectionVersion:1,sourceRevision:2,
    activePackId:'core',activePackAvailable:true,
    savedPackCount:2,installedPackCount:2,
    available:['core','dlc.mist-harbor'],missing:[],unregistered:[],
    requiresAttention:false
  });
  assert.deepEqual(report,previewStoryPackAvailability(save,['core','dlc.mist-harbor']));
  assert.deepEqual(save,before);
  assert.deepEqual(ids,['dlc.mist-harbor','core']);
  assert.ok(Object.isFrozen(report));
  for(const key of ['available','missing','unregistered'])assert.ok(Object.isFrozen(report[key]));
});

test('P2.14 missing DLC does not delete its saved side quests',()=>{
  const save=withDlc();
  save.packs['dlc.mist-harbor'].completed.side.push('lost-compass');
  const before=structuredClone(save);
  const report=previewStoryPackAvailability(save,['core']);
  assert.deepEqual(report.available,['core']);
  assert.deepEqual(report.missing,['dlc.mist-harbor']);
  assert.equal(report.activePackAvailable,true);
  assert.equal(report.requiresAttention,true);
  assert.deepEqual(save,before);
});

test('P2.14 missing active DLC retains the checkpoint',()=>{
  const save=withDlc();
  save.activePackId='dlc.mist-harbor';
  save.packs['dlc.mist-harbor'].checkpoint='chapter-1';
  assert.equal(validateStoryProgress(save),true);
  const report=previewStoryPackAvailability(save,['core']);
  assert.equal(report.activePackAvailable,false);
  assert.equal(report.activePackId,'dlc.mist-harbor');
  assert.equal(save.packs['dlc.mist-harbor'].checkpoint,'chapter-1');
});

test('P2.14 new installed packs are suggestions, not auto-registered progress',()=>{
  const save=registerStoryPack(createEmptyStoryProgress(),'core');
  const report=previewStoryPackAvailability(save,['dlc.other-island','core','dlc.mist-harbor']);
  assert.deepEqual(report.unregistered,['dlc.mist-harbor','dlc.other-island']);
  assert.deepEqual(Object.keys(save.packs),['core']);
  assert.equal(save.revision,1);
  assert.equal(report.requiresAttention,false);
});

test('P2.14 empty progress has no fixed ending or active pack',()=>{
  const report=previewStoryPackAvailability(createEmptyStoryProgress(),[]);
  assert.equal(report.activePackId,null);
  assert.equal(report.activePackAvailable,null);
  assert.equal(report.savedPackCount,0);
  assert.deepEqual(report.missing,[]);
  assert.deepEqual(previewStoryPackAvailability(createEmptyStoryProgress(),['core']).unregistered,['core']);
});

test('P2.14 rejects invalid installed lists and duplicates',()=>{
  const save=withDlc();
  for(const ids of [null,{},'core',['core','core'],['Core'],['../outside'],[null],[1],
    Array.from({length:MAX_STORY_PACKS+1},(_,i)=>'pack-'+i)])
    assert.throws(()=>previewStoryPackAvailability(save,ids),TypeError);
});

test('P2.14 rejects ordinary, mixed and malformed saves',()=>{
  assert.throws(()=>previewStoryPackAvailability(createInitialState(1000000),['core']),TypeError);
  const mixed={...withDlc(),coins:100000};
  assert.throws(()=>previewStoryPackAvailability(mixed,['core']),TypeError);
  const corrupt=withDlc();
  corrupt.packs.core.completed.main=['repeat','repeat'];
  assert.throws(()=>previewStoryPackAvailability(corrupt,['core']),TypeError);
});

test('P2.14 preview is not activated in the existing game interface',()=>{
  const main=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
  assert.equal(main.includes('story-pack-preflight.mjs'),false);
});
