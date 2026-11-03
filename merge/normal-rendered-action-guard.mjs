/**
 * A rendered control may survive a BFCache/visibility transition without a
 * rerender. Its delayed compatibility click must not become a new write.
 * Only a fresh pointerdown in the current page/chooser/save generation can
 * authorize a pointer click; detail=0 keyboard activation stays accessible.
 */
export function bindNormalRenderedAction(button,action,{
  getRenderGeneration,getGestureGeneration,isUnsafe=()=>false,onStale=()=>{}
}={}){
  if(typeof button?.addEventListener!=='function'||typeof action!=='function'||
     typeof getRenderGeneration!=='function'||typeof getGestureGeneration!=='function'||
     typeof isUnsafe!=='function'||typeof onStale!=='function')
    throw new TypeError('INVALID_RENDERED_ACTION_GUARD');
  const renderedAt=getRenderGeneration();
  let pointer=null;
  const unsafe=()=>{try{return isUnsafe()===true;}catch{return true;}};
  button.addEventListener('pointerdown',event=>{
    try{
      pointer={generation:getGestureGeneration(),blocked:unsafe()||
        event.isPrimary===false||(typeof event.button==='number'&&event.button!==0)};
    }catch{pointer={blocked:true};}
  });
  button.addEventListener('pointercancel',()=>{if(pointer)pointer.blocked=true;});
  button.addEventListener('click',event=>{
    let stale=true;
    try{
      stale=renderedAt!==getRenderGeneration()||unsafe()||
        (event.detail!==0&&(!pointer||pointer.blocked||
          pointer.generation!==getGestureGeneration()));
    }catch{/* Fail closed on unexpected lifecycle or DOM state. */}
    pointer=null;
    if(stale){onStale();return;}
    action();
  });
}
