import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve,extname,sep} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';

const root=resolve(new URL('..',import.meta.url).pathname);
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
function chromePath(){
  for(const name of [process.env.CHROME_BIN,'google-chrome','google-chrome-stable',
    'chromium','chromium-browser'].filter(Boolean))
    if(spawnSync(name,['--version'],{encoding:'utf8'}).status===0)return name;
  return null;
}
async function until(check,label,ms=12000){
  const deadline=Date.now()+ms;
  while(Date.now()<deadline){
    try{if(await check())return;}catch{}
    await sleep(75);
  }
  throw Error('TIMEOUT '+label);
}
function cdp(url){
  const ws=new WebSocket(url),pending=new Map();let serial=0;
  const ready=new Promise((resolve,reject)=>{
    ws.addEventListener('open',resolve,{once:true});
    ws.addEventListener('error',reject,{once:true});
  });
  ws.addEventListener('message',event=>{
    const value=JSON.parse(event.data),p=pending.get(value.id);
    if(!p)return;
    pending.delete(value.id);clearTimeout(p.timeout);
    if(value.error)p.reject(Error(JSON.stringify(value.error)));
    else p.resolve(value.result);
  });
  return {ready,close:()=>ws.close(),async call(method,params={},session){
    await ready;
    return new Promise((resolve,reject)=>{
      const id=++serial,timeout=setTimeout(()=>{
        pending.delete(id);reject(Error('CDP timeout '+method));
      },12000);
      pending.set(id,{resolve,reject,timeout});
      ws.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}));
    });
  }};
}

test('mobile one-thumb nav is presentation-only and cannot write save bytes',()=>{
  const js=read('merge/mobile-quick-nav.mjs');
  const css=read('merge/mobile-quick-nav.css');
  assert.doesNotMatch(js,/localStorage|indexedDB|setItem|\.enqueue\(|\.execute\(|\.dispatchEvent\(|\.click\(|\.submit\(|\.pushState\(|location\.hash/);
  assert.match(js,/target\.scrollIntoView/);
  assert.match(js,/target\.focus\(\{preventScroll:true\}\)/);
  assert.match(js,/dialog\.open/);
  assert.match(js,/visualViewport/);
  assert.match(css,/@media\(max-width:600px\)/);
  assert.match(css,/safe-area-inset-bottom/);
  assert.match(css,/min-height:50px/);
  for(const path of ['merge/index.html','merge/story.html','merge/story-workshop.html']){
    const html=read(path);
    assert.match(html,/mobile-quick-nav\.css/);
    assert.doesNotMatch(html,/<script[^>]+src="\.\/mobile-quick-nav\.mjs"/);
    assert.match(html,/aria-label="手机快速导航"/);
  }
  for(const [file,dep] of [
    ['merge/main-locked.mjs',"import './mobile-quick-nav.mjs';"],
    ['merge/story/ui.mjs',"import '../mobile-quick-nav.mjs';"],
    ['merge/story/workshop.mjs',"import '../mobile-quick-nav.mjs';"]
  ])assert.ok(read(file).includes(dep),'one runtime imports pure mobile helper');
});

test('real Chromium 320–430px thumb navigation, keyboard/dialog avoid and no game writes',
  {timeout:100000},async t=>{
    const chrome=chromePath();
    assert.ok(chrome,'real Chromium is required for mobile geometry');
    const tmp=await mkdtemp(join(tmpdir(),'yunyu-thumb-nav-'));
    const server=createServer(async(req,res)=>{
      const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const file=resolve(root,'.'+path);
      if(!file.startsWith(root+sep)){res.writeHead(403).end();return}
      try{
        const bytes=await readFile(file);
        res.writeHead(200,{'Content-Type':{
          '.html':'text/html','.mjs':'text/javascript','.js':'text/javascript',
          '.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'
        }[extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
      }catch{res.writeHead(404).end('not found')}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const browser=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu',
      '--disable-dev-shm-usage','--disable-background-networking',
      '--no-proxy-server','--remote-debugging-port=0','--user-data-dir='+tmp,
      'about:blank'],{stdio:'ignore'});
    let client;
    t.after(async()=>{
      try{client?.close()}catch{}
      browser.kill('SIGKILL');
      await new Promise(resolve=>server.close(resolve));
      await rm(tmp,{recursive:true,force:true,maxRetries:3});
    });
    const portFile=join(tmp,'DevToolsActivePort');
    await until(()=>existsSync(portFile),'Chromium debugger',20000);
    const [port,wsPath]=(await readFile(portFile,'utf8')).trim().split('\n');
    client=cdp('ws://127.0.0.1:'+port+wsPath);
    await client.ready;
    const call=(method,params={},session)=>client.call(method,params,session);
    const {targetId}=await call('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
    await call('Page.enable',{},sessionId);
    await call('Runtime.enable',{},sessionId);
    const evaluate=async(fn,...args)=>{
      const expression='('+fn.toString()+')('+args.map(JSON.stringify).join(',')+')';
      const r=await call('Runtime.evaluate',{
        expression,returnByValue:true,awaitPromise:true,userGesture:true
      },sessionId);
      if(r.exceptionDetails)throw Error('Browser '+JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const navigate=async route=>{
      await call('Page.navigate',{
        url:'http://127.0.0.1:'+server.address().port+route
      },sessionId);
      await until(()=>evaluate(()=>document.readyState==='complete'&&
        !!document.querySelector('.mobile-quick-nav')),'nav load '+route);
      await until(()=>evaluate(()=>document.querySelector('.mobile-quick-nav')?.hidden===false),
        'mobile nav visible '+route);
    };
    async function viewport(width){
      await call('Emulation.setDeviceMetricsOverride',{
        width,height:740,deviceScaleFactor:3,mobile:true
      },sessionId);
      await until(()=>evaluate(x=>document.documentElement.clientWidth===x,width),
        'viewport '+width);
    }
    await viewport(320);
    await navigate('/merge/index.html');
    await until(()=>evaluate(()=>document.getElementById('save-status')?.textContent?.length>0),
      'normal mode loads');
    for(const width of [320,375,390,430]){
      await viewport(width);
      const metrics=await evaluate(()=>{
        const nav=document.querySelector('.mobile-quick-nav');
        const r=nav.getBoundingClientRect();
        return {scrollWidth:document.documentElement.scrollWidth,
          width:document.documentElement.clientWidth,
          height:r.height,bottom:Math.abs(window.innerHeight-r.bottom),
          navHidden:nav.hidden,
          targetHeights:[...nav.querySelectorAll('button')].map(b=>
            b.getBoundingClientRect().height)};
      });
      assert.ok(metrics.scrollWidth<=metrics.width+1,
        'normal game should not overflow at '+width);
      assert.equal(metrics.navHidden,false);
      assert.ok(metrics.height>=50,'nav must be reachable');
      assert.ok(metrics.bottom<=5,'nav is anchored to the lower visual viewport');
      assert.ok(metrics.targetHeights.every(h=>h>=50),
        'thumb navigation hit targets >= 50px');
    }
    const before=await evaluate(()=>({
      raw:localStorage.getItem('toolbox.merge-isle.local.v1'),
      href:location.href
    }));
    await evaluate(()=>{
      const b=document.querySelector('[data-mobile-target="orders-title"]');
      b.click();return true;
    });
    const jumped=await evaluate(()=>({
      focused:document.activeElement.id,scrollY:scrollY,
      raw:localStorage.getItem('toolbox.merge-isle.local.v1'),
      href:location.href
    }));
    assert.equal(jumped.focused,'orders-title');
    assert.ok(jumped.scrollY>50,'orders accessible with one tap');
    assert.equal(jumped.raw,before.raw,'scroll must not write game save');
    assert.equal(jumped.href,before.href,'shortcut must not change URL/hash');
    await evaluate(()=>document.querySelector('[data-mobile-target="mobile-top-anchor"]').click());
    assert.equal(await evaluate(()=>document.activeElement.id),'mobile-top-anchor');

    await evaluate(()=>document.getElementById('supply-producer').focus());
    assert.equal(await evaluate(()=>document.querySelector('.mobile-quick-nav').hidden),true,
      'mobile nav hides during iOS-like input focus');
    await evaluate(()=>document.getElementById('supply-producer').blur());
    await until(()=>evaluate(()=>!document.querySelector('.mobile-quick-nav').hidden),
      'nav reappears after input focus');

    // The source status is near the foot of a long page; a passive mobile
    // mirror must make its text visible without duplicating aria-live output.
    await evaluate(()=>{
      document.getElementById('notice').textContent='手机提示：请先选择物品';
    });
    await until(()=>evaluate(()=>
      document.getElementById('mobile-action-feedback').textContent==='手机提示：请先选择物品'),
      'mobile notice is mirrored');
    const toast=await evaluate(()=>{
      const item=document.getElementById('mobile-action-feedback');
      return {hidden:item.hidden,aria:item.getAttribute('aria-hidden'),
        pointer:getComputedStyle(item).pointerEvents};
    });
    assert.equal(toast.hidden,false);
    assert.equal(toast.aria,'true','screen reader should only hear original aria-live notice');
    assert.equal(toast.pointer,'none','toast cannot steal gameplay touches');
    await evaluate(()=>{document.getElementById('notice').textContent=''});
    await until(()=>evaluate(()=>document.getElementById('mobile-action-feedback').hidden),
      'toast dismisses when original status clears');

    await evaluate(()=>document.getElementById('how-to').click());
    await until(()=>evaluate(()=>document.getElementById('guide').open),
      'native guide modal is open');
    assert.equal(await evaluate(()=>document.querySelector('.mobile-quick-nav').hidden),true,
      'modal hides bottom nav');
    await evaluate(()=>document.getElementById('close-guide').click());
    await until(()=>evaluate(()=>!document.querySelector('.mobile-quick-nav').hidden),
      'nav restored after modal closes');

    await viewport(650);
    assert.equal(await evaluate(()=>
      getComputedStyle(document.querySelector('.mobile-quick-nav')).display),
      'none','tablet/desktop keeps original full layout');

    await viewport(320);
    for(const [path,target] of [
      ['/merge/story.html','entries-title'],
      ['/merge/story-workshop.html','workshop-orders-title']
    ]){
      await navigate(path);
      const pre=await evaluate(()=>location.href);
      await evaluate(id=>{
        document.querySelector('[data-mobile-target="'+id+'"]').click();
      },target);
      assert.equal(await evaluate(()=>document.activeElement.id),target,
        'mobile shortcut targets visible story section');
      assert.equal(await evaluate(()=>location.href),pre,
        'story shortcut never creates new navigation history');
      assert.equal(await evaluate(()=>
        document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),
        true,'story document not wider than 320px');
    }
  });
