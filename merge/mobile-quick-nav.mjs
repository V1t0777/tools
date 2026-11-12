/**
 * Small-screen-only scroll shortcuts for the long, offline Yunyu pages.
 *
 * This module MUST NOT read/write game storage, dispatch game actions, or
 * change the URL/hash. Interactions only scroll and focus existing headings.
 * Never intercept gameplay touch/pointer events.
 */
const bar=document.querySelector('.mobile-quick-nav');
if(bar){
  const buttons=[...bar.querySelectorAll('button[data-mobile-target]')];
  const targets=buttons.map(button=>document.getElementById(button.dataset.mobileTarget));
  const mobile=window.matchMedia('(max-width: 600px)');
  const dialogs=[...document.querySelectorAll('dialog')];
  const viewport=window.visualViewport;
  let editing=false;
  const inputLike=element=>element instanceof HTMLElement&&
    (element.matches('input,textarea,select,[contenteditable="true"]')||
     !!element.closest('[contenteditable="true"]'));
  function update(){
    const dialogOpen=dialogs.some(dialog=>dialog.open);
    // iPhone Safari may resize the *visual* rather than layout viewport
    // on keyboard open. Hide thumb bar during edit, to avoid covering inputs.
    const keyboardLikely=viewport&&viewport.height<
      document.documentElement.clientHeight*.72;
    bar.hidden=!mobile.matches||dialogOpen||editing||Boolean(keyboardLikely);
    buttons.forEach((button,i)=>{
      const target=targets[i];
      button.disabled=!target||target.hidden||
        !!target.closest('[hidden]');
    });
  }
  buttons.forEach((button,i)=>button.addEventListener('click',()=>{
    update();
    const target=targets[i];
    if(bar.hidden||button.disabled||!target)return;
    // A focusable heading announces the destination to VoiceOver, without
    // introducing an URL hash, browser history entry, or storage mutation.
    if(!target.hasAttribute('tabindex'))target.tabIndex=-1;
    target.scrollIntoView({behavior:'instant',block:'start',inline:'nearest'});
    target.focus({preventScroll:true});
  }));
  document.addEventListener('focusin',event=>{
    editing=inputLike(event.target);update();
  });
  document.addEventListener('focusout',event=>{
    if(inputLike(event.target)){
      editing=false;queueMicrotask(()=>{
        editing=inputLike(document.activeElement);update();
      });
    }
  });
  dialogs.forEach(dialog=>new MutationObserver(update).observe(dialog,{
    attributes:true,attributeFilter:['open']
  }));
  mobile.addEventListener?.('change',update);
  viewport?.addEventListener('resize',update,{passive:true});
  window.addEventListener('pageshow',update);
  window.addEventListener('resize',update,{passive:true});
  document.addEventListener('visibilitychange',update);
  update();
}
