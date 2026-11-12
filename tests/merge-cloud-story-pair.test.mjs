import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {createInitialState} from '../merge/engine.mjs';
import {validStoryPair,normalizeStoryPairCommit,hashStoryPairCommit,
  createInMemoryStoryPairAuthority} from '../merge/cloud/story-pair-authority.mjs';

const alice='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bob='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const outsider='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const pair=()=>({progress:createEmptyStoryProgress(),workshop:createInitialState(1000000)});
const cmd=(i,revision,p)=>({operationId:'00000000-0000-4000-8000-'+String(i).padStart(12,'0'),
  expectedRevision:revision,pair:p});
const create=()=>createInMemoryStoryPairAuthority({allowed:uid=>uid===alice||uid===bob});
test('story progress and workshop are a validated isolated two-document pair',()=>{
  assert.equal(validStoryPair(pair()),true);
  const wrong=pair();wrong.workshop.coins=-1;
  assert.equal(validStoryPair(wrong),false);
  assert.equal(validStoryPair({...pair(),normalSave:{coins:9999}}),false);
  assert.equal(normalizeStoryPairCommit({...cmd(1,0,pair()),coins:9999}),null);
  assert.equal(normalizeStoryPairCommit({...cmd(1,0,pair()),operationId:'forged'}),null);
});
test('four-account allowlist blocks unknown identities and is per-user',async()=>{
  const cloud=create();
  assert.equal((await cloud.read(outsider)).code,'CLOUD_ACCESS_DENIED');
  assert.equal((await cloud.commit(outsider,cmd(1,0,pair()))).code,'CLOUD_ACCESS_DENIED');
  assert.equal((await cloud.commit(alice,cmd(1,0,pair()))).status,'applied');
  assert.equal((await cloud.read(bob)).revision,0);
  assert.equal((await cloud.read(bob)).pair,null);
});
test('two concurrent uploads cannot fork server revision',async()=>{
  const cloud=create();
  const [x,y]=await Promise.all([cloud.commit(alice,cmd(1,0,pair())),
    cloud.commit(alice,cmd(2,0,pair()))]);
  assert.equal(x.status==='applied'||y.status==='applied',true);
  assert.equal(x.status==='conflict'||y.status==='conflict',true);
  assert.equal((await cloud.read(alice)).revision,1);
});
test('network acknowledgement lost: exact-id retry is idempotent',async()=>{
  const cloud=create(),request=cmd(1,0,pair());
  assert.equal((await cloud.commit(alice,request)).status,'applied');
  assert.equal((await cloud.commit(alice,request)).status,'replayed');
  assert.equal((await cloud.read(alice)).revision,1);
  assert.equal((await cloud.commit(alice,{...request,pair:{...request.pair,
    workshop:{...request.pair.workshop,coins:1}}})).code,'OPERATION_ID_REUSE');
});
test('explicit rollback is rejected even if the CAS server version matches',async()=>{
  const cloud=create(),first=pair();
  assert.equal((await cloud.commit(alice,cmd(1,0,first))).ok,true);
  const newer=pair();newer.progress.revision=1;newer.workshop.revision=1;
  assert.equal((await cloud.commit(alice,cmd(2,1,newer))).ok,true);
  assert.equal((await cloud.commit(alice,cmd(3,2,pair()))).code,'STORY_ROLLBACK_FORBIDDEN');
  assert.equal((await cloud.read(alice)).revision,2);
});
test('SQL and Edge drafts require service-only four-account CAS',()=>{
  const sql=readFileSync(new URL('../supabase/drafts/merge-story-p3-NOT-APPLIED.sql',import.meta.url),'utf8');
  const edge=readFileSync(new URL('../supabase/functions/merge-story/index.ts',import.meta.url),'utf8');
  const cfg=readFileSync(new URL('../supabase/config.toml',import.meta.url),'utf8');
  for(const requirement of ['DO NOT APPLY','merge_story_pairs','merge_story_operations',
    'merge_cloud_allowlist','FOR UPDATE','ENABLE ROW LEVEL SECURITY',
    'GRANT EXECUTE ON FUNCTION public.merge_story_commit'])
    assert.ok(sql.includes(requirement),requirement);
  assert.match(cfg,/\[functions\.merge-story\]\s*verify_jwt\s*=\s*true/);
  assert.match(edge,/authorizeFourAccountCloudSave\(data\.user,/);
  assert.match(edge,/normalizeStoryPairCommit\(candidate\)/);
  assert.match(edge,/p_expected_revision:command.expectedRevision/);
  assert.doesNotMatch(sql,/GRANT\s+EXECUTE\s+ON\s+FUNCTION[^;]+TO\s+authenticated\s*;/i);
});
