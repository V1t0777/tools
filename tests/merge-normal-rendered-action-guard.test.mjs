import test from 'node:test';
import assert from 'node:assert/strict';
import {bindNormalRenderedAction} from '../merge/normal-rendered-action-guard.mjs';
function fixture(){
  const button=new EventTarget();let render=1,gesture=1,busy=false,calls=0,stale=0;
  bindNormalRenderedAction(button,()=>calls++,{
    getRenderGeneration:()=>render,getGestureGeneration:()=>gesture,
    isUnsafe:()=>busy,onStale:()=>stale++
  });
  const emit=(type,details={})=>button.dispatchEvent(Object.assign(new Event(type),details));
  const down=(details={})=>emit('pointerdown',{isPrimary:true,button:0,...details});
  const click=(detail=1)=>emit('click',{detail});
  return {down,click,emit,get calls(){return calls;},get stale(){return stale;},
    hide(){gesture++;},rerender(){render++;},setBusy(v){busy=v;}};
}
test('fresh pointer click executes one rendered action',()=>{
  const f=fixture();f.down();f.click();assert.equal(f.calls,1);
});
test('BFCache/pagehide gesture invalidation rejects delayed click without rerender',()=>{
  const f=fixture();f.down();f.hide();f.click();assert.equal(f.calls,0);assert.equal(f.stale,1);
  f.down();f.click();assert.equal(f.calls,1);
});
test('native chooser begun after pointerdown invalidates delayed click',()=>{
  const f=fixture();f.down();f.hide();f.click();assert.equal(f.calls,0);
});
test('pointerdown while save busy cannot authorize click after busy clears',()=>{
  const f=fixture();f.setBusy(true);f.down();f.setBusy(false);f.click();assert.equal(f.calls,0);
});
test('pointercancel invalidates synthetic click',()=>{
  const f=fixture();f.down();f.emit('pointercancel');f.click();assert.equal(f.calls,0);
});
test('nonprimary or right mouse pointer is rejected',()=>{
  const f=fixture();f.down({isPrimary:false});f.click();f.down({button:2});f.click();assert.equal(f.calls,0);
});
test('stale detached render refuses pointer and keyboard activations',()=>{
  const f=fixture();f.down();f.rerender();f.click();f.click(0);assert.equal(f.calls,0);
});
test('fresh keyboard click works after visibility change',()=>{
  const f=fixture();f.hide();f.click(0);assert.equal(f.calls,1);
});
test('pointer click without a fresh pointerdown fails closed',()=>{
  const f=fixture();f.click();assert.equal(f.calls,0);
});
test('old pointer lease is consumed and cannot authorize second click',()=>{
  const f=fixture();f.down();f.click();f.click();assert.equal(f.calls,1);
});
