#!/usr/bin/env node
// Strict source allowlist for the public, offline-only Yunyu beta.
// A future private cloud module can NEVER enter the artifact by wildcard.
import {readFileSync,copyFileSync,existsSync,mkdirSync,lstatSync} from 'node:fs';
import {dirname,resolve,join,posix} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const out=join(root,'dist-public');
const manifest=readFileSync(join(root,'scripts/merge-public-files.txt'),'utf8');
const files=manifest.split(/\r?\n/).filter(Boolean);
if(files.length!==78||files.length!==new Set(files).size)throw Error('Unreviewed public manifest length/duplication');
const allowed=files.every(p=>/^merge\/(?:story\/)?[a-z0-9-]+\.(?:mjs|css|html)$/.test(p)&&
  !p.includes('cloud')&&!p.includes('admin')&&!p.includes('secret'));
if(!allowed)throw Error('Unsafe path in offline beta manifest');
const fileSet=new Set(files);
for(const required of ['merge/index.html','merge/story.html','merge/story-workshop.html',
  'merge/main-locked.mjs','merge/mobile-quick-nav.mjs','merge/story/ui.mjs',
  'merge/story/workshop.mjs','merge/story/indexeddb-persistence.mjs'])
  if(!fileSet.has(required))throw Error('Offline runtime missing '+required);
function relativeTo(path,resource){
  if(!resource.startsWith('.'))throw Error('External resource '+resource+' from '+path);
  const target=posix.normalize(posix.join(posix.dirname(path),resource));
  if(!fileSet.has(target))throw Error('Unlisted dependency '+target+' from '+path);
}
for(const path of files){
  const src=join(root,path),destination=join(out,path);
  if(!existsSync(src)||!lstatSync(src).isFile())throw Error('Missing or non-file '+path);
  const body=readFileSync(src,'utf8');
  // Hard no-auth policy; publishing a general info string mentioning "cloud"
  // would be fine, but code/links to unavailable Auth services are not.
  if(/cloud-preview|toolbox-auth|service_role|supabase\.co|sb_publishable_|sb_secret_|functions\/v1|\/merge\/cloud\//i.test(body))
    throw Error('Private cloud reference in public artifact: '+path);
  if(path.endsWith('.mjs')){
    if(/\bimport\s*\(/.test(body))throw Error('Dynamic import is not allowlisted: '+path);
    for(const item of body.matchAll(/\b(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g))
      relativeTo(path,item[1]);
  }
  if(path.endsWith('.html')){
    for(const item of body.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g))
      relativeTo(path,item[1]);
    for(const item of body.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g))
      relativeTo(path,item[1]);
    if(/<script\b[^>]*>[^<\s]/.test(body))
      throw Error('Unexpected inline script in published game: '+path);
  }
  mkdirSync(dirname(destination),{recursive:true});
  copyFileSync(src,destination);
}
console.log('Offline-only Yunyu public artifact: '+files.length+' reviewed files');
