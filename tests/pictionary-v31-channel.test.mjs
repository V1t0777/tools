import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const app=readFileSync(new URL('../pictionary/app.js',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261009154405_pictionary_draw_delivery_v31.sql',import.meta.url),'utf8');
const html=readFileSync(new URL('../pictionary/index.html',import.meta.url),'utf8');

test('only the playing-round drawer can publish to the new private drawing channel',()=>{
 assert.match(sql,/create policy "pictionary draw send realtime"[\s\S]*?for insert to authenticated[\s\S]*?private\.is_pictionary_draw_topic_drawer/);
 assert.match(sql,/r\.status='playing' and rd\.status='drawing'/);
 assert.match(sql,/r\.current_drawer_user_id=\(select auth\.uid\(\)\)/);
 assert.match(sql,/rd\.drawer_user_id=\(select auth\.uid\(\)\)/);
 assert.match(sql,/and p\.active/);
 assert.match(sql,/private\.has_active_session\(\)/);
 assert.match(sql,/grant execute on function private\.is_pictionary_draw_topic_drawer\(text\) to authenticated/);
});
test('the room channel can no longer broadcast a drawing or snapshot',()=>{
 const roomPolicy=sql.slice(sql.indexOf('create policy "pictionary members send realtime"'));
 assert.doesNotMatch(roomPolicy,/'stroke'|'snapshot'|'undo'|'clear'/);
 assert.match(roomPolicy,/'sync_request'/);
 assert.match(roomPolicy,/'ping'/);
});
test('per-round channels require acknowledgments and preserve server fallback',()=>{
 assert.match(app,/pictionary-draw:/);
 assert.match(app,/ack:true,self:false/);
 assert.match(app,/sendDrawEvent\('stroke'/);
 assert.match(app,/sendDrawEvent\('snapshot'/);
 assert.match(app,/function syncDrawingChannel\(/);
 assert.match(app,/function stopDrawingChannel\(/);
 assert.match(app,/drawConnectDeadline=setTimeout/);
 assert.match(app,/Math\.max\(6500,telemetry\.profile\(\)\.recoveryMs\)/);
 assert.match(app,/p\.canvas_revision/);
});
test('assets are cache-busted without exposing private pages on public Pages',()=>{
 assert.match(html,/app\.js\?v=20261009-v31/);
 assert.match(sql,/private\.is_pictionary_draw_topic_member/);
 assert.doesNotMatch(sql,/\bgrant\s+execute[^;]*\bto\s+anon\b/i);
});
