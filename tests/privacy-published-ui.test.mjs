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
  'dinner/index.html','dinner/app.js','beads/index.html','beads/app.js','beads/mard-palette.js',
  'flappy/index.html','stack/index.html','pictionary/index.html','pictionary/app.js','pictionary/perf.js',
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


// A public frontend must not contain production contact/identity literals.
// Exclude strings embedded inside hexadecimal digests; these are heuristic guards,
// not proof of absence of PII (names, addresses or encoded values need separate review).
const mainlandPhone=/(?<![0-9A-Fa-f])1[3-9]\d{9}(?![0-9A-Fa-f])/;
const mainlandIdentity=/(?<![0-9A-Za-z])[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![0-9A-Za-z])/;

test('published first-party pages/scripts contain no mainland phone or identity-card literals',()=>{
  for(const file of publishable){
    const contents=readFileSync(new URL('../'+file,import.meta.url),'utf8');
    assert.doesNotMatch(contents,mainlandPhone,file+' contains a possible mainland phone literal');
    assert.doesNotMatch(contents,mainlandIdentity,file+' contains a possible identity-card literal');
  }
});
test('personal-identifier patterns detect representative synthetic fixtures',()=>{
  assert.match('Test phone: 13800138000',mainlandPhone);
  assert.match('Synthetic identity: 11010519491231002X',mainlandIdentity);
  assert.doesNotMatch('SHA fragment: a13800138000b',mainlandPhone);
});
