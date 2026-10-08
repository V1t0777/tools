(function(global){
'use strict';
// TOTP setup and fresh challenge for sensitive roster writes. No secret or one-time code is persisted.
const AUTH=global.ToolboxAuth;
const ROOT=AUTH.url+'/auth/v1';
function fail(message){throw new Error(message);}
async function request(path,method='GET',body){
  const session=await AUTH.getSession();
  if(!session?.access_token)fail('请重新登录后操作');
  const response=await fetch(ROOT+path,{
    method,cache:'no-store',headers:{apikey:AUTH.key,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const result=await response.json().catch(()=>null);
  if(!response.ok)fail(response.status===429?'操作过于频繁，请稍后再试':'身份验证失败，请重试');
  return result;
}
function modal(title,message,secret,qr){
  return new Promise((resolve)=>{
    const overlay=document.createElement('div');
    overlay.setAttribute('role','dialog');
    overlay.setAttribute('aria-modal','true');
    overlay.setAttribute('aria-label',title);
    overlay.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;padding:16px;';
    const panel=document.createElement('section');
    panel.style.cssText='width:min(420px,100%);max-height:90vh;overflow:auto;border:1px solid #536178;border-radius:18px;background:#171f2b;color:white;padding:22px;box-shadow:0 20px 70px #0009;';
    const heading=document.createElement('h2');heading.textContent=title;heading.style.margin='0 0 14px';
    const hint=document.createElement('p');hint.textContent=message;hint.style.lineHeight='1.55';
    panel.append(heading,hint);
    if(qr&&/^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/.test(qr)){
      const img=document.createElement('img');img.src=qr;img.alt='身份验证器绑定二维码';
      img.style.cssText='display:block;width:190px;max-width:100%;margin:10px auto;background:white;padding:8px;border-radius:12px';
      panel.append(img);
    }
    if(secret){
      const label=document.createElement('p');label.textContent='如无法扫描二维码，请在身份验证器中手动输入下方密钥（请勿截图、转发）：';panel.append(label);
      const value=document.createElement('code');value.textContent=secret;value.style.cssText='display:block;word-break:break-all;padding:12px;border-radius:8px;background:#293445;font-size:14px';panel.append(value);
    }
    const input=document.createElement('input');input.type='text';input.inputMode='numeric';input.autocomplete='one-time-code';input.maxLength=6;input.placeholder='6 位动态验证码';
    input.setAttribute('aria-label','6 位动态验证码');input.style.cssText='display:block;width:100%;box-sizing:border-box;padding:12px;margin:16px 0;border-radius:8px;font-size:18px';
    const err=document.createElement('p');err.style.color='#ffc0c0';err.setAttribute('role','status');
    const row=document.createElement('div');row.style.cssText='display:flex;gap:12px';
    const cancel=document.createElement('button');cancel.textContent='取消';cancel.type='button';
    const confirm=document.createElement('button');confirm.textContent='验证';confirm.type='button';
    for(const b of [cancel,confirm])b.style.cssText='flex:1;padding:12px;border-radius:9px;cursor:pointer';
    row.append(cancel,confirm);panel.append(input,err,row);overlay.append(panel);document.body.append(overlay);
    const finish=v=>{input.value='';overlay.remove();resolve(v)};
    cancel.addEventListener('click',()=>finish(null));
    confirm.addEventListener('click',()=>{const value=input.value.trim();if(!/^\d{6}$/.test(value)){err.textContent='请输入 6 位数字验证码';return;}finish(value);});
    input.addEventListener('keydown',e=>{if(e.key==='Enter')confirm.click();if(e.key==='Escape')finish(null)});
    input.focus();
  });
}
let inflight=null;
async function stepUp(){
  const user=await request('/user');
  const factors=(user?.factors||[]).filter(x=>x.factor_type==='totp'&&x.status==='verified');
  let factor=factors[0],isEnrollment=!factor,secret='',qr='';
  if(isEnrollment){
    const started=await request('/factors','POST',{factor_type:'totp',friendly_name:'工具箱管理员身份验证'});
    factor=started;
    secret=started?.totp?.secret||'';
    qr=started?.totp?.qr_code||'';
    if(!factor?.id||!secret)fail('身份验证器绑定未完成，请检查服务设置');
  }
  // Challenge is issued by GoTrue and verified by GoTrue (never by client-side JS).
  const challenge=await request('/factors/'+encodeURIComponent(factor.id)+'/challenge','POST',{});
  if(!challenge?.id)fail('无法发起身份验证');
  const code=await modal(isEnrollment?'绑定管理员验证器':'管理员敏感操作验证',
    isEnrollment?'首次修改排班前，请用身份验证器添加 TOTP 动态密码，并输入生成的 6 位验证码。':'每次保存排班均须使用身份验证器重新验证，验证码不会保存。',
    secret,qr);
  if(!code)return false;
  const result=await request('/factors/'+encodeURIComponent(factor.id)+'/verify','POST',{challenge_id:challenge.id,code});
  if(!result?.access_token||!result?.refresh_token)fail('验证响应不完整，未进行保存');
  await AUTH.adoptVerifiedSession(result);
  await AUTH.probe(true);
  return true;
}
global.ToolboxMFA={ensureRecent:()=>{if(!inflight)inflight=stepUp().finally(()=>{inflight=null});return inflight;}};
})(window);
