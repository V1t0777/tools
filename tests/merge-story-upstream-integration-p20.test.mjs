import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareAbnormalResetBackupExport} from '../merge/save-export.mjs';
import {SAVE_KEY,ABNORMAL_RESET_BACKUP_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';

const source=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('P20 normal-mode page preserves both manual backup controls and story entry',()=>{
  const html=source('../merge/index.html');
  for(const id of ['export-local-save','export-abnormal-reset-backup','reset'])
    assert.equal(html.split('id="'+id+'"').length-1,1,id);
  assert.ok(html.includes('<a class="story-entry-link" href="./story.html">'));
  assert.ok(html.includes('下载不等于恢复'));
  const ui=source('../merge/main.mjs');
  assert.ok(ui.includes("byId('export-abnormal-reset-backup').addEventListener('click'"));
  assert.ok(ui.includes('prepareAbnormalResetBackupExport(store)'));
});

test('P20 merged CSS retains mobile touch target and distinct story entry treatment',()=>{
  const css=source('../merge/style.css');
  assert.ok(css.includes('.save-actions .text-button{min-height:44px'));
  assert.ok(css.includes('.save-actions #export-local-save,.save-actions #export-abnormal-reset-backup{'));
  assert.ok(css.includes('.story-entry-link{display:inline-flex;align-items:center;justify-content:center;min-height:44px'));
  assert.ok(css.includes('@media(prefers-color-scheme:dark){.story-entry-link'));
  assert.ok(css.includes('@media(max-width:380px){.board-footer'));
});

test('P20 abnormal reset backup exporter only reads dedicated normal-mode evidence key',()=>{
  assert.notEqual(SAVE_KEY,ABNORMAL_RESET_BACKUP_KEY);
  assert.notEqual(ABNORMAL_RESET_BACKUP_KEY,STORY_SAVE_KEY);
  assert.notEqual(ABNORMAL_RESET_BACKUP_KEY,STORY_WORKSHOP_KEY);
  const reads=[];
  const storage={
    getItem(key){
      reads.push(key);
      if(key===ABNORMAL_RESET_BACKUP_KEY)return '{bad original save';
      throw Error('unexpected storage key');
    },
    setItem(){throw Error('read-only export must never write');}
  };
  const exported=prepareAbnormalResetBackupExport(storage);
  assert.equal(exported.ok,true);
  assert.equal(exported.backup,true);
  assert.equal(exported.verified,false);
  assert.equal(exported.content,'{bad original save');
  assert.equal(exported.filename,'yunyu-abnormal-reset-original.txt');
  assert.deepEqual(reads,[ABNORMAL_RESET_BACKUP_KEY]);
});

test('P20 missing backup never falls back to normal or story save',()=>{
  const reads=[];
  const storage={getItem(key){reads.push(key);return null;},setItem(){throw Error('unexpected write');}};
  const result=prepareAbnormalResetBackupExport(storage);
  assert.equal(result.ok,false);
  assert.equal(result.reason,'NO_SAVED_DATA');
  assert.deepEqual(reads,[ABNORMAL_RESET_BACKUP_KEY]);
});
