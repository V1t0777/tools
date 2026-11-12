/**
 * A persistent story control is not recreated by render(). A compatibility
 * click arriving after BFCache/visibility or a new render must not reuse a
 * pointerdown from the previous UI generation. This is an interaction guard,
 * NOT a substitute for the storage/Web Locks write authorization.
 */
export function guardStoryPersistentGesture(button,getGeneration,onRejected){
  let pointerGeneration=null,cancelled=false;
  button.addEventListener('pointerdown',()=>{
    pointerGeneration=getGeneration();cancelled=false;
  });
  button.addEventListener('pointercancel',()=>{cancelled=true;});
  button.addEventListener('click',event=>{
    const expired=cancelled||(pointerGeneration!==null&&
      pointerGeneration!==getGeneration());
    pointerGeneration=null;cancelled=false;
    // Keyboard activation (detail 0) is a fresh, independent intention.
    if(event?.detail===0||!expired)return;
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
    onRejected?.();
  });
}
