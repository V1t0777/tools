#!/usr/bin/env node
// Scans *published source*, never prints matched personal data.
import {readdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const targets=[
  ...readdirSync(resolve(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')).map(x=>'supabase/migrations/'+x),
  ...readdirSync(resolve(root,'supabase/schema')).filter(x=>/\.(sql|json)$/.test(x)).map(x=>'supabase/schema/'+x)
];
const email=/\b[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9.-]+\.)+[A-Za-z]{2,}\b/g;
// Require a full literal, not an 11-digit substring of a SHA-256 hexadecimal digest.
const phone=/(?<![0-9A-Fa-f])1[3-9]\d{9}(?![0-9A-Fa-f])/g;
const namedSeed=/insert\s+into\s+public\.(?:staff|admin_users)\s*\(/gi;
let violations=0;
for(const path of targets){
  const content=readFileSync(resolve(root,path),'utf8');
  const found=[];
  for(const hit of content.matchAll(email)){
    if(!/@(?:example\.(?:invalid|com|org|net)|localhost)$/i.test(hit[0]))found.push('account-email');
  }
  if(phone.test(content))found.push('possible-phone');phone.lastIndex=0;
  if(namedSeed.test(content))found.push('direct-personnel-seed');namedSeed.lastIndex=0;
  if(found.length){
    process.stderr.write('::error file='+path+'::Potential personal data: '+[...new Set(found)].join(', ')+'\n');
    violations++;
  }
}
if(violations)process.exit(1);
console.log('Privacy scan passed: '+targets.length+' SQL/catalog files, zero identifiable account literals or personnel seed inserts.');
