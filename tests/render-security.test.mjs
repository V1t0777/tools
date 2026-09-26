import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
function fn(source,name){
  const start=source.indexOf('  function '+name+'(');
  assert.ok(start>=0);
  const end=source.indexOf('\n  function ',start+1);
  assert.ok(end>start);
  return source.slice(start,end);
}
const payload='<img src=x onerror="alert(1)">';
for(const game of ['flappy','stack']){
  const source=readFileSync(new URL('../'+game+'/index.html',import.meta.url),'utf8');
  test(game+' leaderboard treats names, ranks and scores as text',()=>{
    const row={rank:payload,nickname:payload,score:payload,color:'red; background:url(https://example.invalid)',achieved_at:'2026-09-26',perfect_count:payload,max_combo:payload};
    const list={innerHTML:''};
    const sandbox={leaderboardData:{all_time:[row],weekly:[row]},leaderboardMode:'all_time',leaderboardList:list,Intl};
    vm.runInNewContext(fn(source,'escapeHTML')+'\n'+fn(source,'renderLeaderboard')+'\nrenderLeaderboard();',sandbox);
    assert.ok(!list.innerHTML.includes('<img'));
    assert.ok(list.innerHTML.includes('&lt;img'));
    assert.ok(!list.innerHTML.includes('background:url'));
  });
  test(game+' leaderboard retains ordinary numeric scores',()=>{
    const list={innerHTML:''},row={rank:1,nickname:'Friend',score:42,color:'#abcdef',achieved_at:'2026-09-26'};
    vm.runInNewContext(fn(source,'escapeHTML')+'\n'+fn(source,'renderLeaderboard')+'\nrenderLeaderboard();',{leaderboardData:{all_time:[row]},leaderboardMode:'all_time',leaderboardList:list,Intl});
    assert.match(list.innerHTML,/42/);assert.match(list.innerHTML,/Friend/);
  });
}
test('Pictionary rejects CSS declarations and escapes score markup',()=>{
  const source=readFileSync(new URL('../pictionary/app.js',import.meta.url),'utf8');
  const elements=new Map();
  const sandbox={state:{room:{host_member_id:'me'},players:[{member_id:'me',nickname:payload,score:payload,color:'red; background:url(https://example.invalid)',ready:true}]},me:{id:'me'},presenceMembers:new Set(),
    $:id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',classList:{toggle(){}}});return elements.get(id);}};
  const names=['escapeHTML','renderPlayers','renderScores','renderRanking'];
  // These production helpers are single-line functions, avoiding adjacent closures.
  const code=names.map(name=>source.split('\n').find(line=>line.startsWith('  function '+name+'('))).join('\n');
  vm.runInNewContext(code+'\nrenderPlayers();renderScores();renderRanking();',sandbox);
  for(const id of ['players','scoreStrip','ranking']){
    const html=elements.get(id).innerHTML;
    assert.ok(!html.includes('<img'));assert.ok(!html.includes('background:url'));
    assert.match(html,/&lt;img/);
  }
});
