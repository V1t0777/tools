import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,join,posix} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const source=path=>readFileSync(join(root,path),'utf8');
const files=source('scripts/merge-public-files.txt').trim().split(/\r?\n/);
const set=new Set(files);
test('public Yunyu release is precisely 78 reviewed offline resources, no cloud/auth',()=>{
  assert.equal(files.length,78);assert.equal(set.size,78);
  assert.deepEqual(files.slice().sort(),files,'manifest must be stable sorted');
  for(const path of files){
    assert.match(path,/^merge\/(?:story\/)?[a-z0-9-]+\.(mjs|html|css)$/);
    assert.ok(existsSync(join(root,path)),path);
    assert.doesNotMatch(path,/cloud|admin|secret/i);
    assert.doesNotMatch(source(path),/cloud-preview|toolbox-auth|service_role|supabase\.co|sb_publishable_|sb_secret_|functions\/v1|\/merge\/cloud\//i,path);
  }
  const index=source('merge/index.html');
  assert.match(index,/公开试玩版/);
  assert.match(index,/仅保存在当前浏览器/);
  assert.doesNotMatch(index,/cloud-preview\.html/);
  assert.match(source('games/index.html'),/https:\/\/v1t0777\.github\.io\/tools\/merge\//);
});
test('every offline JS import, HTML script and local CSS path is in public manifest',()=>{
  const refs=[];
  for(const file of files){
    const body=source(file);
    if(file.endsWith('.mjs')){
      assert.doesNotMatch(body,/\bimport\s*\(/,file);
      for(const match of body.matchAll(/\b(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g))refs.push([file,match[1]]);
    }
    if(file.endsWith('.html')){
      for(const match of body.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g))refs.push([file,match[1]]);
      for(const match of body.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g))refs.push([file,match[1]]);
    }
  }
  for(const [from,relative] of refs){
    assert.ok(relative.startsWith('.'),'unexpected remote dependency in '+from);
    const dest=posix.normalize(posix.join(posix.dirname(from),relative));
    assert.ok(set.has(dest),from+' -> '+dest);
  }
});
test('public build contains offline beta and never includes private cloud source',()=>{
  execFileSync('bash',['scripts/build-public.sh'],{cwd:root,stdio:'pipe'});
  for(const file of files)assert.ok(existsSync(join(root,'dist-public',file)),file);
  for(const path of ['merge/cloud','merge/cloud-preview.html','merge/cloud-preview.mjs','merge/cloud-preview.css',
    'shared/toolbox-auth.js','shared/vendor/supabase-2.57.4.min.js'])
    assert.equal(existsSync(join(root,'dist-public',path)),false,path);
});
