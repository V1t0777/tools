#!/usr/bin/env node
// Fail-closed inventory of XSS-capable APIs in published authenticated source.
import {readFileSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const pages=['cloudflare-secure/index.html','admin-night-shift/index.html','night-shift/index.html','beads/index.html','dinner/index.html','pictionary/index.html','blackjack/index.html','flappy/index.html','stack/index.html','games/index.html'];
const scripts=['shared/toolbox-ui.js','shared/toolbox-auth.js','shared/toolbox-mfa.js','beads/app.js','beads/mard-palette.js','dinner/app.js','pictionary/app.js','blackjack/app.js'];
const allowedSinks=new Map([['beads/app.js',4],['pictionary/app.js',6],['flappy/index.html',6],['stack/index.html',9],['shared/toolbox-ui.js',1]]);
let failed=false;
function reject(path,message){process.stderr.write('::error file='+path+'::'+message+'\n');failed=true;}
for(const path of [...pages,...scripts]){
 const text=readFileSync(resolve(root,path),'utf8');
 const sinkCount=[...text.matchAll(/\.innerHTML\s*=/g)].length;
 if(sinkCount!==(allowedSinks.get(path)||0))reject(path,'HTML sink inventory changed ('+sinkCount+'). Review and update baseline after escaping audit.');
 if(/\bdocument\s*\.\s*write\s*\(|\beval\s*\(|\bnew\s+Function\s*\(|\.insertAdjacentHTML\s*\(/.test(text))
   reject(path,'Executable or HTML injection sink is prohibited.');
 if(path.endsWith('.html')){
   if(/<\s*[a-z][^>]*\s+on(?:click|load|error|focus|input|change|submit|mouseover)\s*=/i.test(text))
     reject(path,'Inline event handlers forbidden by script-src-attr.');
   for(const found of text.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"'<>]+)["'][^>]*>/gi)){
     const uri=found[1].split(/[?#]/)[0];
     if(/^(?:https?:|\/\/|data:|javascript:)/i.test(uri)||uri.startsWith('/'))
       {reject(path,'Script must be bundled from reviewed local paths.');continue;}
     const absolute=resolve(dirname(resolve(root,path)),uri);
     if(!absolute.startsWith(root+'/')||!/\.js$/.test(absolute)||!scripts.some(p=>resolve(root,p)===absolute)&&!absolute.includes('/shared/vendor/'))
       reject(path,'Unreviewed script source: '+uri);
   }
 }
}
const headers=readFileSync(resolve(root,'cloudflare-secure/_headers'),'utf8');
for(const directive of ["script-src 'self'","script-src-attr 'none'","object-src 'none'","base-uri 'self'","frame-ancestors 'none'"]){
 if(!headers.includes(directive))reject('cloudflare-secure/_headers','Required CSP directive missing: '+directive);
}
if(failed)process.exit(1);
console.log('XSS audit passed: reviewed script source allowlist, existing HTML sinks frozen, no executable injection APIs.');
