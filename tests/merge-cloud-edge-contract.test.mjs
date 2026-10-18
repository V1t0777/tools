import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeCommand} from '../merge/cloud/authority.mjs';
const code=readFileSync(new URL('../supabase/functions/merge-game/index.ts',import.meta.url),'utf8');
test('Edge draft keeps keys on server, verifies JWT, and never uses request userId',()=>{
  assert.ok(code.includes("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')"));
  assert.ok(code.includes('anon.auth.getUser(bearer)'));
  assert.ok(code.includes('game.execute(data.user.id,body.command)'));
  assert.ok(!/body\.userId|body\.coins|body\.nextState/.test(code));
  assert.ok(code.includes("'Cache-Control':'no-store'"));
  assert.ok(code.includes('ORIGIN_NOT_ALLOWED'));
  assert.ok(code.includes('REQUEST_TOO_LARGE'));
});
test('operation envelope boundary excludes self-specified user and future rewards',()=>{
  const good={operationId:'00000000-0000-4000-8000-000000000001',expectedRevision:0,action:{type:'order',orderId:'o0'}};
  assert.ok(normalizeCommand(good));
  assert.equal(normalizeCommand({...good,userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}),null);
  assert.equal(normalizeCommand({...good,result:{coins:999}}),null);
  assert.equal(normalizeCommand({...good,action:{...good.action,earnedCoins:999}}),null);
});