/** A single game URL with opt-in independent normal and cloud saves.
 * Private cloud login is loaded only from the allowlisted secure artifact.
 */
const offline=document.querySelector('body > .shell');
const cloud=document.getElementById('cloud-suite');
const localButton=document.getElementById('cloud-mode-local');
const onlineButton=document.getElementById('cloud-mode-online');
if(!offline||!cloud||!localButton||!onlineButton)
  throw Error('Unified Yunyu game markup unavailable');
const choose=mode=>{
  const online=mode==='cloud';
  offline.hidden=online;
  cloud.hidden=!online;
  localButton.setAttribute('aria-pressed',String(!online));
  onlineButton.setAttribute('aria-pressed',String(online));
  document.title=online?'云屿百物铺 · 私有云存档':'云屿百物铺 · 本地试玩';
  const url=new URL(location.href);
  if(online)url.searchParams.set('mode','cloud');
  else url.searchParams.delete('mode');
  history.replaceState(history.state,'',url.href);
};
localButton.addEventListener('click',()=>choose('local'));
onlineButton.addEventListener('click',()=>choose('cloud'));
choose(new URL(location.href).searchParams.get('mode')==='cloud'?'cloud':'local');
