#!/usr/bin/env node
/**
 * Secure Cloudflare artifact: explicit two-manifest file allowlist.
 * No service role keys, SQL, Edge sources, mock repository or server-only
 * game authorities are copied into the client origin.
 */
import {readFileSync,copyFileSync,existsSync,mkdirSync,lstatSync} from 'node:fs';
import {resolve,join,dirname,posix} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const out=join(root,'dist-secure');
const lists=[
  readFileSync(join(root,'scripts/merge-public-files.txt'),'utf8')
    .split(/\r?\n/).filter(Boolean),
  readFileSync(join(root,'scripts/merge-cloud-secure-files.txt'),'utf8')
    .split(/\r?\n/).filter(Boolean)
];
const [offline,cloud]=lists;
const expected=17;
if(offline.length!==78||cloud.length!==expected||cloud.join('\n')!==
  cloud.slice().sort().join('\n'))throw Error('Secure merge allowlist drift');
const paths=[...offline,...cloud],allowed=new Set(paths);
if(allowed.size!==95)throw Error('Duplicate secure game resource');
for(const path of cloud){
  if(!/^merge\/(?:cloud\/)?[a-z0-9-]+\.(?:html|css|mjs)$/.test(path)||
     /(?:secret|admin|db-authority|mock|economy-audit|private-access|receipt-lookup|bounded-json)/.test(path))
    throw Error('Invalid secure-only frontend module '+path);
}
const abs=path=>join(root,path);
function relative(from,resource){
  if(!resource.startsWith('.'))throw Error('Non-relative import in '+from);
  const target=posix.normalize(posix.join(posix.dirname(from),resource));
  if(!allowed.has(target))throw Error('Missing secure import '+from+' -> '+target);
}
for(const path of paths){
  const from=abs(path),target=join(out,path);
  if(!existsSync(from)||!lstatSync(from).isFile())
    throw Error('Missing or non-file resource '+path);
  const data=readFileSync(from,'utf8');
  if(/sb_secret_|SUPABASE_SERVICE_ROLE_KEY|MERGE_ALLOWED_ORIGIN|Deno\.env\.get\(|CREATE TABLE|SECURITY DEFINER/.test(data))
    throw Error('Privileged server material in secure frontend: '+path);
  if(path.endsWith('.mjs')){
    if(/\bimport\s*\(/.test(data))throw Error('Dynamic module import forbidden in '+path);
    for(const m of data.matchAll(/\b(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g))
      relative(path,m[1]);
  }
  if(path==='merge/cloud-preview.html'){
    const scripts=[...data.matchAll(/<script\b[^>]*>/gi)].map(x=>x[0]);
    if(scripts.length!==2||
      !scripts.some(x=>/^<script src="\.\.\/shared\/toolbox-auth\.js" defer>$/i.test(x))||
      !scripts.some(x=>/^<script type="module" src="\.\/cloud-preview\.mjs">$/i.test(x))||
      /<script\b[^>]*>\s*[^\s<]+/i.test(data))
      throw Error('Unreviewed private cloud login script');
  }
  mkdirSync(dirname(target),{recursive:true});
  copyFileSync(from,target);
}
// The secure origin renders offline + authenticated cloud modes on ONE game
// page. The public artifact never receives login scripts or cloud modules.
const sourceGame=readFileSync(join(out,'merge/index.html'),'utf8');
const privatePage=readFileSync(join(root,'merge/cloud-preview.html'),'utf8');
const mainMatch=privatePage.match(/<main>([\s\S]*?)<\/main>/);
if(!mainMatch||!sourceGame.includes('<body>')||!sourceGame.includes('</body>'))
  throw Error('Unified cloud page source structure changed');
let privateContent=mainMatch[1].replace(/\b(id|for|aria-labelledby|aria-controls|aria-describedby)="([^"]+)"/g,
  (_,attr,value)=>attr+'="'+value.split(/\s+/).map(token=>'cloud-'+token).join(' ')+'"');
const nav='<nav id="cloud-mode-tabs" class="cloud-mode-tabs" aria-label="游戏存档模式"><button type="button" id="cloud-mode-local" aria-pressed="true">本地试玩</button><button type="button" id="cloud-mode-online" aria-pressed="false">☁ 云存档</button><a href="https://v1t0777.github.io/tools/merge/">查看原 GitHub 本地存档</a></nav><p class="cloud-origin-note">云端经营仅四位已验证账号可用；本站本地档与旧 GitHub Pages 本地档因域名不同而独立，切换模式不会上传、合并或覆盖本地数据。</p>';
const extraHead='<link rel="stylesheet" href="./cloud-integrated.css"><script src="../shared/toolbox-auth.js" defer></script><script type="module" src="./cloud-preview.mjs"></script><script type="module" src="./cloud-integrated-nav.mjs"></script>';
const combined=sourceGame.replace('</head>',extraHead+'\n</head>')
  .replace('<body>', '<body>\n'+nav)
  .replace('</body>','<section id="cloud-suite" class="cloud-suite" hidden><main>'+privateContent+'</main></section>\n</body>');
if(combined===sourceGame||!combined.includes('id="cloud-login-form"')||
   !combined.includes('id="cloud-story-upload"')||
   !combined.includes('id="cloud-game"'))
  throw Error('Cloud integration lost authenticated UI controls');
const unifiedPath=join(out,'merge/index.html');
import {writeFileSync} from 'node:fs';
writeFileSync(unifiedPath,combined,'utf8');
console.log('Private integrated Yunyu game ready: '+paths.length+' allowlisted files');
