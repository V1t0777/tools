import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const root='https://v1t0777.github.io/tools/';
const games=`${root}games/`;

const ordinaryPages=[
  'admin-night-shift/index.html',
  'beads/index.html',
  'birthday/index.html',
  'cloudflare-secure/index.html',
  'coin/index.html',
  'cs2-sensitivity/index.html',
  'dinner/index.html',
  'games/index.html',
  'mokugyo/index.html',
  'night-shift/index.html',
];

const gamePages=[
  'blackjack/index.html',
  'flappy/index.html',
  'pictionary/index.html',
  'snake/index.html',
  'stack/index.html',
];

function source(path){
  return readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
}

function returnLinks(html){
  return [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .filter(([, ,body])=>/^(?:←|返回)/.test(body.replace(/<[^>]*>/g,'').trim()))
    .map(([,href])=>href);
}

test('ordinary secondary pages return to the GitHub Pages home page',()=>{
  for(const path of ordinaryPages){
    const links=returnLinks(source(path));
    assert.ok(links.length>0,`${path} has no return link`);
    assert.deepEqual([...new Set(links)],[root],`${path} has an unexpected return target`);
  }
});

test('game pages return to the public games page',()=>{
  for(const path of gamePages){
    const links=returnLinks(source(path));
    assert.ok(links.length>0,`${path} has no return link`);
    assert.deepEqual([...new Set(links)],[games],`${path} has an unexpected return target`);
  }
});

test('no secondary-page return link targets a mirror or old relative address',()=>{
  for(const path of [...ordinaryPages,...gamePages]){
    for(const href of returnLinks(source(path))){
      assert.doesNotMatch(href,/pages\.dev|workers\.dev|^\.\.?\//,`${path}: ${href}`);
    }
  }
});
