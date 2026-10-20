import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInitialState, validateSave, SAVE_VERSION } from '../merge/engine.mjs';
import { SAVE_KEY, saveLocal } from '../merge/storage.mjs';
import {
  GAME_MODES, STORY_PROGRESS_VERSION, STORY_SAVE_KEY,
  MAX_STORY_PACKS, MAX_STORY_SAVE_BYTES, getModeSaveKey,
  createEmptyStoryProgress, createEmptyStoryPack,
  validateStoryProgress, registerStoryPack
} from '../merge/mode-boundaries.mjs';

test('P2.12 normal play key is unchanged and story has an entirely distinct namespace',()=>{
  assert.deepEqual(GAME_MODES,{NORMAL:'normal',STORY:'story'});
  assert.equal(getModeSaveKey(GAME_MODES.NORMAL),SAVE_KEY);
  assert.equal(getModeSaveKey(GAME_MODES.STORY),STORY_SAVE_KEY);
  assert.notEqual(STORY_SAVE_KEY,SAVE_KEY);
  assert.equal(SAVE_KEY,'toolbox.merge-isle.local.v1');
  assert.equal(SAVE_VERSION,3);
  assert.throws(()=>getModeSaveKey(''),RangeError);
  assert.throws(()=>getModeSaveKey('developer'),RangeError);
});

test('P2.12 empty story progression does not assume a final chapter or grant normal-mode resources',()=>{
  const empty=createEmptyStoryProgress();
  assert.deepEqual(empty,{
    schemaVersion:STORY_PROGRESS_VERSION,mode:'story',
    revision:0,activePackId:null,packs:{}
  });
  assert.equal(validateStoryProgress(empty),true);
  assert.equal(validateSave(empty),false);
  for(const field of ['coins','energy','xp','bag','shop','achievements','board'])
    assert.equal(Object.hasOwn(empty,field),false);
  assert.notStrictEqual(createEmptyStoryProgress(),empty);
});

test('P2.12 registering story content packs is immutable, idempotent and DLC-compatible',()=>{
  const empty=createEmptyStoryProgress();
  const base=registerStoryPack(empty,'core');
  const expansion=registerStoryPack(base,'dlc.mist-harbor');
  assert.equal(empty.revision,0);
  assert.equal(empty.activePackId,null);
  assert.deepEqual(empty.packs,{});
  assert.equal(base.revision,1);
  assert.equal(base.activePackId,'core');
  assert.deepEqual(base.packs.core,createEmptyStoryPack());
  assert.equal(expansion.revision,2);
  assert.equal(expansion.activePackId,'core');
  assert.equal(Object.keys(expansion.packs).length,2);
  assert.equal(validateStoryProgress(expansion),true);
  assert.strictEqual(registerStoryPack(expansion,'core'),expansion);
  assert.notStrictEqual(expansion.packs['dlc.mist-harbor'],base.packs.core);
});

test('P2.12 mainline, side quests, incidents and decisions are pack-local and branchable',()=>{
  const base=registerStoryPack(registerStoryPack(createEmptyStoryProgress(),'core'),'dlc.mist-harbor');
  const save=structuredClone(base);
  save.packs.core.checkpoint='arrival';
  save.packs.core.completed.main.push('find-the-shop');
  save.packs.core.completed.side.push('help-the-fisher');
  save.packs.core.completed.incident.push('unexpected-storm');
  save.packs.core.choices['visitor-response']='wait';
  save.packs.core.flags['met-the-owner']=true;
  save.packs['dlc.mist-harbor'].checkpoint='chapter-1';
  save.packs['dlc.mist-harbor'].completed.side.push('lost-compass');
  assert.equal(validateStoryProgress(save),true);
  assert.deepEqual(base.packs.core.completed.main,[]);
  assert.deepEqual(save.packs['dlc.mist-harbor'].completed.main,[]);
  assert.deepEqual(save.packs['dlc.mist-harbor'].completed.incident,[]);
  assert.equal(validateSave(save),false);
});

test('P2.12 strict story mode validation rejects tampered resources and invalid active packs',()=>{
  const valid=registerStoryPack(createEmptyStoryProgress(),'core');
  const mutated=[
    x=>{x.mode='normal';},
    x=>{x.schemaVersion=2;},
    x=>{x.revision=-1;},
    x=>{x.revision=Number.MAX_SAFE_INTEGER+1;},
    x=>{x.coins=99999;},
    x=>{x.energy=120;},
    x=>{x.activePackId='dlc.unknown';},
    x=>{x.packs.core.checkpoint={script:'not-data'};},
    x=>{x.packs.core.completed.main=['repeated','repeated'];},
    x=>{x.packs.core.completed.side=['ok','Invalid Path'];},
    x=>{x.packs.core.completed.incident=['__proto__'];},
    x=>{x.packs.core.choices['intro']='';},
    x=>{x.packs.core.flags['finished']='yes';},
    x=>{Object.defineProperty(x.packs.core.flags,'__proto__',{value:true,enumerable:true});},
    x=>{delete x.packs.core.completed.side;},
    x=>{x.packs.core.shop={purchases:{}};},
    x=>{x.packs['../outside']=createEmptyStoryPack();},
    x=>{x.packs['__proto__']=createEmptyStoryPack();}
  ];
  for(const mutate of mutated){
    const broken=structuredClone(valid);
    mutate(broken);
    assert.equal(validateStoryProgress(broken),false,'unexpectedly accepted '+JSON.stringify(broken).slice(0,100));
  }
});

test('P2.12 script-like IDs, fake pack names and invalid inputs cannot register',()=>{
  const save=createEmptyStoryProgress();
  for(const id of ['',null,4,'../outside','__proto__','constructor','Core',
      'core/../evil','dlc.foo.bar','dlc.constructor','prototype',
    'evil_name','x'.repeat(65)]){
    assert.throws(()=>registerStoryPack(save,id),TypeError);
  }
  assert.throws(()=>registerStoryPack(null,'core'),TypeError);
  assert.throws(()=>registerStoryPack({...save,coins:10},'core'),TypeError);
});

test('P2.12 pack registration is bounded to a finite number of DLCs and revisions',()=>{
  let story=createEmptyStoryProgress();
  for(let i=0;i<MAX_STORY_PACKS;i++){
    story=registerStoryPack(story,'pack-'+i);
    assert.equal(validateStoryProgress(story),true);
  }
  assert.equal(Object.keys(story.packs).length,MAX_STORY_PACKS);
  assert.throws(()=>registerStoryPack(story,'additional-pack'),RangeError);
  const overflow=structuredClone(story);
  overflow.packs['additional-pack']=createEmptyStoryPack();
  assert.equal(validateStoryProgress(overflow),false);
  const exhausted=createEmptyStoryProgress();
  exhausted.revision=Number.MAX_SAFE_INTEGER;
  assert.equal(validateStoryProgress(exhausted),true);
  assert.throws(()=>registerStoryPack(exhausted,'core'),RangeError);
});

test('P2.12 story data budget prevents excessively long saves and malformed flag maps',()=>{
  const story=registerStoryPack(createEmptyStoryProgress(),'core');
  const lots=structuredClone(story);
  lots.packs.core.completed.main=Array.from({length:513},(_,i)=>'main-'+i);
  assert.equal(validateStoryProgress(lots),false);
  const many=structuredClone(story);
  for(let i=0;i<257;i++)many.packs.core.flags['flag-'+i]=true;
  assert.equal(validateStoryProgress(many),false);
  const large=structuredClone(story);
  large.packs.core.completed.side=Array.from({length:512},(_,i)=>
    'quest-'+String(i).padStart(6,'0')+'a'.repeat(40));
  assert.equal(validateStoryProgress(large),true);
  const tooLarge=createEmptyStoryProgress();
  for(let pack=0;pack<MAX_STORY_PACKS;pack++){
    const key='pack-'+pack;
    tooLarge.packs[key]=createEmptyStoryPack();
    tooLarge.packs[key].completed.main=Array.from({length:512},(_,i)=>
      'quest-'+String(i).padStart(6,'0')+'x'.repeat(40));
  }
  assert.ok(JSON.stringify(tooLarge).length>MAX_STORY_SAVE_BYTES);
  assert.equal(validateStoryProgress(tooLarge),false);
});

test('P2.12 existing normal save writer refuses story save and never touches story namespace',()=>{
  const state=createInitialState(1_000_000);
  const story=registerStoryPack(createEmptyStoryProgress(),'core');
  const calls=[];
  const storage={
    getItem:key=>{calls.push(['get',key]);return null;},
    setItem:(key,value)=>{calls.push(['set',key,value]);}
  };
  assert.equal(validateSave(state),true);
  assert.equal(saveLocal(storage,story),false);
  assert.equal(calls.length,0);
  assert.equal(saveLocal(storage,state),true);
  assert.ok(calls.some(x=>x[0]==='set'&&x[1]===SAVE_KEY));
  assert.ok(calls.every(x=>x[1]!==STORY_SAVE_KEY));
});

test('P2.12 future story module has no browser storage writes, fetch, or execution hooks',()=>{
  const script=readFileSync(new URL('../merge/mode-boundaries.mjs',import.meta.url),'utf8');
  const main=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
  for(const forbidden of ['localStorage','sessionStorage','fetch(','XMLHttpRequest',
    'navigator.sendBeacon','eval(','Function(']){
    assert.equal(script.includes(forbidden),false,'forbidden side effect '+forbidden);
  }
  assert.equal(main.includes('mode-boundaries.mjs'),false,
    'current preview must not accidentally activate story mode');
});
