import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
for(const path of ['night-shift/index.html','admin-night-shift/index.html','beads/app.js','dinner/app.js','pictionary/app.js']){
  test(path+' does not log raw error objects',()=>{
    const s=read(path);
    assert.equal(s.includes('console.error(err);'),false);
    assert.equal(s.includes('console.error(error);'),false);
    assert.equal(s.includes('console.warn(err);'),false);
  });
}
