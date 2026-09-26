import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

function git(root,args,allowed=[0]){
  const result=spawnSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024,timeout:120000});
  if(result.error||!allowed.includes(result.status))throw new Error('Git history scan could not complete');
  return result.stdout;
}
export function readPatterns(){
  const source=readFileSync(new URL('./security-check.sh',import.meta.url),'utf8');
  const block=source.match(/patterns=\(([\s\S]*?)\n\)/)?.[1];
  const patterns=[...(block||'').matchAll(/^  '(.+)'$/gm)].map(x=>x[1]);
  if(patterns.length<8)throw new Error('Secret rules missing or malformed');
  return patterns;
}
export function scanHistory(root=process.cwd(),patterns=readPatterns()){
  if(git(root,['rev-parse','--is-shallow-repository']).trim()!=='false')throw new Error('Full history required');
  const commits=git(root,['rev-list','--all','HEAD']).trim().split('\n').filter(Boolean);
  if(!commits.length||commits.some(x=>!/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(x)))throw new Error('Invalid commit inventory');
  if(!patterns.length)throw new Error('No secret rules');
  const findings=[];
  // Search full committed snapshots, not diffs. Deleted files remain in old trees.
  // NUL-separated filename-only output prevents secret contents entering logs.
  for(let i=0;i<commits.length;i+=20){
    const output=git(root,['grep','--no-textconv','-l','-I','-z','-E',
      ...patterns.flatMap(p=>['-e',p]),...commits.slice(i,i+20),'--','.'],[0,1]);
    for(const location of output.split('\0').filter(Boolean))findings.push(location);
  }
  return {commits:commits.length,findings:[...new Set(findings)]};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const result=scanHistory();
    for(const location of result.findings)console.error('Potential historical secret at '+JSON.stringify(location));
    console.log('Scanned '+result.commits+' reachable commits (text files only).');
    if(result.findings.length)process.exitCode=1;
  }catch{
    console.error('Historical scan incomplete: require a full checkout and successful Git commands.');
    process.exitCode=2;
  }
}
