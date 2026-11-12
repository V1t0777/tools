import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,join,posix} from 'node:path';
import {execFileSync} from 'node:child_process';
import {auditOfflineHtml} from '../scripts/merge-html-audit.mjs';
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
  assert.match(source('games/index.html'),/https:\/\/zhao-toolbox-secure\.pages\.dev\/merge\/index\.html/);
  assert.match(index,/https:\/\/zhao-toolbox-secure\.pages\.dev\/merge\/index\.html\?mode=cloud/);
  assert.doesNotMatch(index,/toolbox-auth\.js|cloud-preview\.mjs/);
});
test('every offline JS import, HTML script and local CSS path is in public manifest',()=>{
  const refs=[];
  for(const file of files){
    const body=source(file);
    if(file.endsWith('.mjs')){
      assert.doesNotMatch(body,/\bimport\s*\(/,file);
      for(const match of body.matchAll(/\b(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g))refs.push([file,match[1]]);
    }
    if(file.endsWith('.html'))
      auditOfflineHtml(body,file,(path,relative)=>refs.push([path,relative]));
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

test('public HTML script audit is case-insensitive and forbids executable inline tags',()=>{
  const seen=[];
  const valid='<SCRIPT TYPE="MODULE" SRC="./main-locked.mjs"></SCRIPT>'+
    '<LINK REL="STYLESHEET" HREF="./style.css">'+
    '<LINK REL="STYLESHEET" HREF="./mobile-quick-nav.css">';
  auditOfflineHtml(valid,'merge/index.html',(path,resource)=>seen.push(resource));
  assert.deepEqual(seen,['./main-locked.mjs','./style.css','./mobile-quick-nav.css']);
  for(const injected of [
    '<SCRIPT>alert(1)</SCRIPT>',
    '<script type="module" src="./main-locked.mjs" onload="alert(1)"></script>',
    '<script type="module" src="https://evil.invalid/main.mjs"></script>',
    '<script type="module" src="./main-locked.mjs">alert(1)</script>',
    '<script type="module" src="./main-locked.mjs"></script>'+
      '<SCRIPT TYPE="MODULE" SRC="./evil.mjs"></SCRIPT>'
  ])assert.throws(()=>auditOfflineHtml(injected+
    '<link rel="stylesheet" href="./style.css">'+
    '<link rel="stylesheet" href="./mobile-quick-nav.css">',
    'merge/index.html',()=>{}));
});
