import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scanHistory} from '../scripts/secret-history.mjs';
function fixture(fn){
  const root=mkdtempSync(join(tmpdir(),'toolbox-history-'));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const commit=()=>{git('add','.');git('-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','-m','fixture');};
  try{git('init','-b','main');writeFileSync(join(root,'file.txt'),'safe');commit();fn({root,git,commit});}
  finally{rmSync(root,{recursive:true,force:true});}
}
test('clean complete history passes',()=>fixture(({root})=>{
  assert.deepEqual(scanHistory(root),{commits:1,findings:[]});
}));
test('deleted historical secret is found without exposing its value',()=>fixture(({root,git,commit})=>{
  const value='sb_'+'secret_'+'x'.repeat(30);
  writeFileSync(join(root,'removed.txt'),value);commit();const sha=git('rev-parse','HEAD');
  rmSync(join(root,'removed.txt'));commit();
  const result=scanHistory(root);assert.equal(result.commits,3);
  assert.ok(result.findings.includes(sha+':removed.txt'));assert.ok(!JSON.stringify(result).includes(value));
}));
test('non-current branch history is also scanned',()=>fixture(({root,git,commit})=>{
  git('checkout','-b','other');writeFileSync(join(root,'file.txt'),'gh'+'p_'+'x'.repeat(30));commit();
  git('checkout','main');assert.ok(scanHistory(root).findings.length);
}));
test('shallow checkout and invalid patterns fail closed',()=>fixture(({root,git})=>{
  assert.throws(()=>scanHistory(root,['[']));
  writeFileSync(join(root,'.git','shallow'),git('rev-parse','HEAD')+'\n');
  assert.throws(()=>scanHistory(root),/Full history/);
}));
test('non-repository does not report a successful scan',()=>{
  const root=mkdtempSync(join(tmpdir(),'toolbox-history-'));
  try{assert.throws(()=>scanHistory(root));}finally{rmSync(root,{recursive:true,force:true});}
});
