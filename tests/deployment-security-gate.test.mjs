import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const pages = readFileSync(new URL('../.github/workflows/pages.yml',import.meta.url),'utf8');
const security = readFileSync(new URL('../.github/workflows/security-checks.yml',import.meta.url),'utf8');

test('public Pages deployment cannot bypass the full security gate',()=>{
  const required = [
    'fetch-depth: 0',
    'bash scripts/security-check.sh',
    'node --test tests/*.test.mjs scripts/*.test.cjs',
    'node scripts/secret-history.mjs',
    'actions/upload-pages-artifact@'
  ];
  let cursor=-1;
  for(const step of required){
    const next=pages.indexOf(step,cursor+1);
    assert.ok(next>cursor,`missing or out of order before Pages upload: ${step}`);
    cursor=next;
  }
  assert.match(pages,/needs:\s*build\b/);
  assert.match(pages,/persist-credentials:\s*false/);
  assert.match(pages,/permissions:\s*\n\s*contents:\s*read/);
  assert.match(pages,/path:\s*dist-public/);
});

test('three security workflow jobs remain independent',()=>{
  for(const job of ['static-security','regression-tests','history-secrets'])
    assert.match(security,new RegExp('^  '+job+':','m'));
  assert.match(security,/fetch-depth:\s*0/);
  assert.doesNotMatch(security,/^    needs:/m);
});
