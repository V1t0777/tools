import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findEmailLiterals} from '../scripts/privacy-email.mjs';

// First-party source pages/scripts shipped to public GitHub Pages or Cloudflare Pages.
// This intentionally excludes vendor code, tests and server/database migrations.
const publishable=[
  'index.html','birthday/index.html','coin/index.html','cs2-sensitivity/index.html',
  'games/index.html','mokugyo/index.html','snake/index.html',
  'cloudflare-secure/index.html','admin-night-shift/index.html','night-shift/index.html',
  'dinner/index.html','dinner/app.js','beads/index.html','beads/app.js',
  'flappy/index.html','stack/index.html','pictionary/index.html','pictionary/app.js',
  'blackjack/index.html','blackjack/app.js',
  'shared/toolbox-auth.js','shared/toolbox-mfa.js','shared/toolbox-ui.js'
];
test('published first-party pages/scripts contain no literal login email addresses',()=>{
  for(const file of publishable){
    const contents=readFileSync(new URL('../'+file,import.meta.url),'utf8');
    assert.equal(findEmailLiterals(contents).length,0, file+' contains an email literal');
  }
});
test('Flappy test accounts remain excluded without showing account identity',()=>{
  const contents=readFileSync(new URL('../flappy/index.html',import.meta.url),'utf8');
  assert.match(contents,/excluded_account/);
  assert.match(contents,/当前账号为测试账号/);
  assert.match(contents,/成绩不参与排名/);
});
