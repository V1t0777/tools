/**
 * Pure navigation, never alters story workshop game state or storage.
 * Exposes 44px horizontal board controls on compact phone screens and
 * supports swipe/keyboard on the existing scrollable board viewport.
 */
const wrap=document.getElementById('workshop-board-viewport');
const controls=document.getElementById('workshop-board-controls');
const previous=document.getElementById('workshop-board-left');
const next=document.getElementById('workshop-board-right');
if(wrap&&controls&&previous&&next){
  function update(){
    const max=Math.max(0,wrap.scrollWidth-wrap.clientWidth);
    controls.hidden=max<=1;
    previous.disabled=max<=1||wrap.scrollLeft<=1;
    next.disabled=max<=1||wrap.scrollLeft>=max-1;
  }
  function move(direction){
    const distance=Math.max(44,Math.floor(wrap.clientWidth*.7));
    const max=Math.max(0,wrap.scrollWidth-wrap.clientWidth);
    wrap.scrollLeft=Math.min(max,Math.max(0,wrap.scrollLeft+direction*distance));
    update();
  }
  previous.addEventListener('click',()=>move(-1));
  next.addEventListener('click',()=>move(1));
  wrap.addEventListener('scroll',update,{passive:true});
  window.addEventListener('resize',update,{passive:true});
  window.addEventListener('pageshow',update);
  if(typeof ResizeObserver==='function'){
    const resize=new ResizeObserver(update);
    resize.observe(wrap);
    const board=document.getElementById('workshop-board');
    if(board)resize.observe(board);
  }
  requestAnimationFrame(update);
}
