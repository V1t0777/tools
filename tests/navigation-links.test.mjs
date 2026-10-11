import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {returnLinks} from '../scripts/static-anchor-links.mjs';

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

test('static anchor reader supports nested text, quoted attributes and ignores false tags',()=>{
  const html='<aside>not a link</aside><a data-note="> no close" href="https://example.test/">'
    +'<span aria-hidden="true">←</span><span>工具箱</span></a>'
    +"<a href='https://example.test/games/'>返回小游戏</a>";
  assert.deepEqual(returnLinks(html),['https://example.test/','https://example.test/games/']);
  assert.deepEqual(returnLinks('<a href="/somewhere">其他页面</a>'),[]);
  assert.throws(()=>returnLinks('<a href="/broken">返回'),/Unclosed anchor/);
});
