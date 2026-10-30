import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {captureStoryWorkshopEvidence,prepareStoryEvidenceDownload,isPreparedStoryEvidenceCurrent,MAX_STORY_EVIDENCE_CHARS} from '../merge/story/save-evidence.mjs';
import {requestBrowserSaveDownload,DOWNLOAD_URL_LIFETIME_MS} from '../merge/save-download.mjs';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
const storage=()=>{
  const data=new Map([[STORY_WORKSHOP_KEY,'{ damaged 🏝️'],[SAVE_KEY,'normal save']]);
  return {data,getItem:key=>data.has(key)?data.get(key):null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
};
test('P9 evidence capture needs explicit consent, preserves exact text and never modifies normal save',()=>{
  const store=storage(),raw=store.getItem(STORY_WORKSHOP_KEY);
  assert.equal(captureStoryWorkshopEvidence(store,{key:STORY_WORKSHOP_KEY,expectedRaw:raw}).code,'CONSENT_REQUIRED');
  assert.equal(captureStoryWorkshopEvidence(store,{key:STORY_WORKSHOP_KEY,expectedRaw:null,confirmedByUser:true}).code,'NO_SNAPSHOT');
  assert.deepEqual(captureStoryWorkshopEvidence(store,{key:STORY_WORKSHOP_KEY,expectedRaw:raw,confirmedByUser:true}),{ok:true,code:'OK',content:raw});
  assert.equal(store.getItem(STORY_WORKSHOP_KEY),raw);
  assert.equal(store.getItem(SAVE_KEY),'normal save');
});
test('P9 rejects a stale, deleted, unreadable or oversized evidence snapshot without writes',()=>{
  const store=storage(),raw=store.getItem(STORY_WORKSHOP_KEY);
  store.setItem(STORY_WORKSHOP_KEY,'another tab changed this');
  assert.equal(captureStoryWorkshopEvidence(store,{key:STORY_WORKSHOP_KEY,expectedRaw:raw,confirmedByUser:true}).code,'STALE_SNAPSHOT');
  store.removeItem(STORY_WORKSHOP_KEY);
  assert.equal(captureStoryWorkshopEvidence(store,{key:STORY_WORKSHOP_KEY,expectedRaw:raw,confirmedByUser:true}).code,'STALE_SNAPSHOT');
  assert.equal(captureStoryWorkshopEvidence({getItem(){throw Error('private browsing denied');}},{key:STORY_WORKSHOP_KEY,expectedRaw:raw,confirmedByUser:true}).code,'STORAGE_UNAVAILABLE');
  const huge='x'.repeat(MAX_STORY_EVIDENCE_CHARS+1);
  store.setItem(STORY_WORKSHOP_KEY,huge);
  assert.equal(captureStoryWorkshopEvidence(store,{key:STORY_WORKSHOP_KEY,expectedRaw:huge,confirmedByUser:true}).code,'TOO_LARGE');
  assert.equal(store.getItem(SAVE_KEY),'normal save');
});
test('P9 recovery UI is opt-in, offline and does not claim a successful device download',()=>{
  const html=readFileSync(new URL('../merge/story-workshop.html',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../merge/story/workshop.mjs',import.meta.url),'utf8');
  assert.ok(html.includes('id="export-corrupt-workshop"'));
  assert.ok(ui.includes("reason!=='CORRUPT_SAVE'||typeof raw!=='string'"));
  assert.ok(ui.includes('captureStoryWorkshopEvidence(storage,{key:STORY_WORKSHOP_KEY,expectedRaw:raw,confirmedByUser:true})'));
  assert.ok(ui.includes('requestBrowserSaveDownload'));
  assert.ok(ui.includes('已尝试下载'));
  assert.ok(ui.includes("if(reason==='CORRUPT_SAVE'&&!window.confirm"));
  for(const dangerous of ['innerHTML','insertAdjacentHTML','fetch(','sendBeacon(','SAVE_KEY','localStorage.setItem'])
    assert.equal(ui.includes(dangerous),false,dangerous);
});

test('P10 damaged narrative save can be captured only with consent and exact snapshot',()=>{
  const store=storage(),raw='{ broken narrative 🏝️';
  store.setItem(STORY_SAVE_KEY,raw);
  assert.equal(captureStoryWorkshopEvidence(store,{key:STORY_SAVE_KEY,expectedRaw:raw}).code,'CONSENT_REQUIRED');
  assert.deepEqual(captureStoryWorkshopEvidence(store,{key:STORY_SAVE_KEY,expectedRaw:raw,confirmedByUser:true}),
    {ok:true,code:'OK',content:raw});
  assert.equal(store.getItem(STORY_SAVE_KEY),raw);
  assert.equal(store.getItem(STORY_WORKSHOP_KEY),'{ damaged 🏝️');
  assert.equal(store.getItem(SAVE_KEY),'normal save');
  store.setItem(STORY_SAVE_KEY,'changed in another tab');
  assert.equal(captureStoryWorkshopEvidence(store,{key:STORY_SAVE_KEY,expectedRaw:raw,confirmedByUser:true}).code,'STALE_SNAPSHOT');
  assert.equal(store.getItem(STORY_SAVE_KEY),'changed in another tab');
});
test('P10 narrative export UI is opt-in, offline, and warns before damaged reset',()=>{
  const html=readFileSync(new URL('../merge/story.html',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  assert.ok(html.includes('id="export-corrupt-story"'));
  assert.ok(ui.includes("reason!=='CORRUPT_SAVE'||typeof raw!=='string'"));
  assert.ok(ui.includes('captureStoryWorkshopEvidence(store,{key:STORY_SAVE_KEY,expectedRaw:raw,confirmedByUser:true})'));
  assert.ok(ui.includes('requestBrowserSaveDownload'));
  assert.ok(ui.includes('已尝试下载异常对白记录'));
  assert.ok(ui.includes("if(reason==='CORRUPT_SAVE'&&!window.confirm"));
  for(const dangerous of ['innerHTML','insertAdjacentHTML','fetch(','sendBeacon(','localStorage.setItem'])
    assert.equal(ui.includes(dangerous),false,dangerous);
});

test('P11 corrupt evidence export is restricted to story keys before any storage read',()=>{
  const store=storage(),normal=store.getItem(SAVE_KEY);
  let reads=0;
  const guarded={getItem(key){reads++;return store.getItem(key);}};
  assert.deepEqual(captureStoryWorkshopEvidence(guarded,{
    key:SAVE_KEY,expectedRaw:normal,confirmedByUser:true
  }),{ok:false,code:'INVALID_KEY'});
  assert.deepEqual(captureStoryWorkshopEvidence(guarded,{
    key:'unrelated.personal.key',expectedRaw:'private',confirmedByUser:true
  }),{ok:false,code:'INVALID_KEY'});
  assert.equal(reads,0,'invalid keys must be rejected without reading storage');
  assert.equal(store.getItem(SAVE_KEY),normal);
  assert.equal(captureStoryWorkshopEvidence(guarded,{
    key:STORY_WORKSHOP_KEY,expectedRaw:store.getItem(STORY_WORKSHOP_KEY),confirmedByUser:true
  }).code,'OK');
  store.setItem(STORY_SAVE_KEY,'{damaged narrative');
  assert.equal(captureStoryWorkshopEvidence(guarded,{
    key:STORY_SAVE_KEY,expectedRaw:'{damaged narrative',confirmedByUser:true
  }).code,'OK');
});

test('P85 story evidence download preserves normal Unicode text and paired emoji as plain UTF-8',async()=>{
  const raw='{ invalid 🏝️ }\n中文';
  const download=prepareStoryEvidenceDownload(raw,'yunyu-story-dialogue-corrupt-save');
  assert.equal(download.wrapped,false);
  assert.equal(download.filename,'yunyu-story-dialogue-corrupt-save.txt');
  assert.equal(await new Blob([download.content]).text(),raw);
});

test('P85 isolated high/low UTF-16 surrogates use a reversible non-import JSON envelope',async()=>{
  for(const raw of [
    'before'+String.fromCharCode(0xD800)+'after',
    'before'+String.fromCharCode(0xDC00)+'after',
    'paired 🏝️ and '+String.fromCharCode(0xD800)+' broken'
  ]){
    const download=prepareStoryEvidenceDownload(raw,'yunyu-story-workshop-corrupt-save');
    assert.equal(download.wrapped,true);
    assert.equal(download.filename,'yunyu-story-workshop-corrupt-save.utf16.json');
    const decoded=JSON.parse(await new Blob([download.content]).text());
    assert.equal(decoded.format,'yunyu-story-evidence-utf16-v1');
    assert.equal(decoded.raw,raw,'all original UTF-16 code units survive browser Blob encoding');
    assert.equal(decoded.raw.length,raw.length);
  }
});

test('P85 corrupt narrative/workshop evidence remains read-only and mode isolated',()=>{
  const store=storage(),normal=store.getItem(SAVE_KEY);
  for(const key of [STORY_SAVE_KEY,STORY_WORKSHOP_KEY]){
    const raw='damaged '+String.fromCharCode(0xD800);
    store.setItem(key,raw);
    const captured=captureStoryWorkshopEvidence(store,{key,expectedRaw:raw,confirmedByUser:true});
    assert.equal(captured.ok,true);
    assert.equal(JSON.parse(prepareStoryEvidenceDownload(captured.content,'yunyu-story-evidence').content).raw,raw);
    assert.equal(store.getItem(key),raw);
    assert.equal(store.getItem(SAVE_KEY),normal);
  }
});

test('P85 both story export entry points label reversible evidence without claiming disk success',()=>{
  for(const path of ['../merge/story/workshop.mjs','../merge/story/ui.mjs']){
    const source=readFileSync(new URL(path,import.meta.url),'utf8');
    assert.ok(source.includes('prepareStoryEvidenceDownload(evidence.content'),path);
    assert.ok(source.includes('download.filename'),path);
    assert.ok(source.includes('download.wrapped'),path);
    assert.ok(source.includes('非可直接导入的存档'),path);
    assert.ok(source.includes('已尝试下载'),path);
  }
});

test('P86 story evidence uses a bounded shared Blob URL lifecycle without touching either save',async()=>{
  const store=storage(),normal=store.getItem(SAVE_KEY);
  const raw='damaged '+String.fromCharCode(0xD800)+' tail';
  store.setItem(STORY_SAVE_KEY,raw);
  const evidence=captureStoryWorkshopEvidence(store,{
    key:STORY_SAVE_KEY,expectedRaw:raw,confirmedByUser:true
  });
  const prepared=prepareStoryEvidenceDownload(evidence.content,'yunyu-story-dialogue-corrupt-save');
  const clicked=[],revoked=[],scheduled=[];
  let clock=1000;
  const urlApi={
    createObjectURL(blob){assert.equal(blob.type,'application/json;charset=utf-8');return 'blob:story-p86';},
    revokeObjectURL(url){revoked.push(url);}
  };
  const doc={
    body:{append(){}},
    createElement(){return {
      set href(value){assert.equal(value,'blob:story-p86');},
      set download(value){assert.equal(value,prepared.filename);},
      click(){clicked.push(true);},remove(){}
    };}
  };
  const receipt=requestBrowserSaveDownload({
    ok:true,content:prepared.content,filename:prepared.filename,
    mime:'application/json;charset=utf-8'
  },{doc,urlApi,BlobCtor:Blob,schedule:(fn,ms)=>scheduled.push({fn,ms}),now:()=>clock});
  assert.equal(receipt.ok,true);
  assert.equal(clicked.length,1);
  assert.deepEqual(revoked,[],'URL must outlive the anchor click');
  assert.equal(scheduled[0].ms,DOWNLOAD_URL_LIFETIME_MS);
  clock+=DOWNLOAD_URL_LIFETIME_MS;
  scheduled[0].fn();
  assert.deepEqual(revoked,['blob:story-p86']);
  assert.equal(store.getItem(STORY_SAVE_KEY),raw);
  assert.equal(store.getItem(SAVE_KEY),normal);
});

test('P86 oversized UTF-16 evidence envelope fails closed before allocating an object URL',()=>{
  const raw=String.fromCharCode(0xD800).repeat(400_000);
  const store=storage();
  store.setItem(STORY_WORKSHOP_KEY,raw);
  const evidence=captureStoryWorkshopEvidence(store,{
    key:STORY_WORKSHOP_KEY,expectedRaw:raw,confirmedByUser:true
  });
  assert.equal(evidence.ok,true);
  const prepared=prepareStoryEvidenceDownload(evidence.content,'yunyu-story-workshop-corrupt-save');
  assert.equal(prepared.wrapped,true);
  let allocations=0;
  const result=requestBrowserSaveDownload({
    ok:true,content:prepared.content,filename:prepared.filename,
    mime:'application/json;charset=utf-8'
  },{doc:{body:{append(){}},createElement(){return {};}},
    urlApi:{createObjectURL(){allocations++;return 'blob:should-not-exist';},revokeObjectURL(){}},
    BlobCtor:Blob,schedule(){},now:()=>1000});
  assert.equal(result.ok,false);
  assert.equal(result.reason,'DOWNLOAD_TOO_LARGE');
  assert.equal(allocations,0);
  assert.equal(store.getItem(STORY_WORKSHOP_KEY),raw);
  assert.equal(store.getItem(SAVE_KEY),'normal save');
});

test('P86 both story export handlers use the shared bounded download receipt, not raw Blob URLs',()=>{
  for(const path of ['../merge/story/workshop.mjs','../merge/story/ui.mjs']){
    const source=readFileSync(new URL(path,import.meta.url),'utf8');
    assert.ok(source.includes('requestBrowserSaveDownload({'),path);
    assert.ok(source.includes("receipt.reason==='DOWNLOAD_TOO_LARGE'"),path);
    assert.ok(source.includes("receipt.reason==='DOWNLOAD_LIMIT_REACHED'"),path);
    assert.ok(!source.includes('URL.createObjectURL'),path);
    assert.ok(!source.includes('URL.revokeObjectURL'),path);
    assert.ok(source.includes('已尝试下载'),path);
  }
});

test('P87 both story evidence keys recheck exact UTF-16 source bytes before download',()=>{
  const store=storage(),normal=store.getItem(SAVE_KEY);
  for(const key of [STORY_SAVE_KEY,STORY_WORKSHOP_KEY]){
    const raw='{"revision":7,"choice":"yes"}';
    store.setItem(key,raw);
    const download=prepareStoryEvidenceDownload(raw,'yunyu-story-evidence');
    const options={key,expectedRaw:raw,download};
    assert.equal(isPreparedStoryEvidenceCurrent(store,options),true);
    store.setItem(key,'{"choice":"yes","revision":7}');
    assert.equal(isPreparedStoryEvidenceCurrent(store,options),false,
      'same parsed JSON with different raw bytes must be refused');
    store.setItem(key,raw);
    assert.equal(isPreparedStoryEvidenceCurrent(store,options),true);
  }
  assert.equal(store.getItem(SAVE_KEY),normal,'normal-mode save remains untouched');
});

test('P87 reversible UTF-16 evidence compares isolated surrogate code units',()=>{
  const store=storage();
  const raw='damaged'+String.fromCharCode(0xD800)+'tail';
  store.setItem(STORY_SAVE_KEY,raw);
  const download=prepareStoryEvidenceDownload(raw,'yunyu-story-dialogue-corrupt-save');
  assert.equal(download.wrapped,true);
  const options={key:STORY_SAVE_KEY,expectedRaw:raw,download};
  assert.equal(isPreparedStoryEvidenceCurrent(store,options),true);
  store.setItem(STORY_SAVE_KEY,raw.replace(String.fromCharCode(0xD800),'\uFFFD'));
  assert.equal(isPreparedStoryEvidenceCurrent(store,options),false);
  store.setItem(STORY_SAVE_KEY,raw);
  assert.equal(isPreparedStoryEvidenceCurrent(store,{
    ...options,download:{...download,content:'{broken-json'}
  }),false);
  assert.equal(isPreparedStoryEvidenceCurrent(store,{
    ...options,download:{...download,content:JSON.stringify({format:'other',raw})}
  }),false);
});

test('P87 invalid keys, missing preparation and storage failures refuse without reads or writes',()=>{
  const raw='damaged',download=prepareStoryEvidenceDownload(raw,'yunyu-story-evidence');
  let reads=0,writes=0;
  const guarded={
    getItem(){reads++;return raw;},
    setItem(){writes++;}
  };
  assert.equal(isPreparedStoryEvidenceCurrent(guarded,{key:SAVE_KEY,expectedRaw:raw,download}),false);
  assert.equal(isPreparedStoryEvidenceCurrent(guarded,{key:'private',expectedRaw:raw,download}),false);
  assert.equal(isPreparedStoryEvidenceCurrent(guarded,{key:STORY_SAVE_KEY,expectedRaw:null,download}),false);
  assert.equal(isPreparedStoryEvidenceCurrent(guarded,{
    key:STORY_SAVE_KEY,expectedRaw:raw,download:{...download,wrapped:'yes'}
  }),false);
  assert.equal(reads,0,'invalid requests must not inspect storage');
  assert.equal(isPreparedStoryEvidenceCurrent({
    getItem(){throw Error('storage denied');}
  },{key:STORY_SAVE_KEY,expectedRaw:raw,download}),false);
  assert.equal(writes,0);
});

test('P87 both actual story UI exports recheck snapshot and lifecycle before Blob click',()=>{
  for(const path of ['../merge/story/workshop.mjs','../merge/story/ui.mjs']){
    const source=readFileSync(new URL(path,import.meta.url),'utf8');
    const preflight=source.indexOf('!isPreparedStoryEvidenceCurrent(');
    const click=source.indexOf('const receipt=requestBrowserSaveDownload({');
    assert.ok(preflight>0&&click>preflight,path);
    assert.ok(source.slice(preflight-90,preflight).includes('pageSuspended()'),path);
    assert.ok(source.includes('expectedRaw:evidence.content,download'),path);
    assert.ok(source.includes('文件准备期间已变化或页面暂停'),path);
    assert.equal(source.includes('localStorage.setItem'),false,path);
  }
});
