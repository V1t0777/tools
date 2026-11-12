/** Support the existing ToolboxAuth.createClient().auth (getSession only).
 * Token verification uses GoTrue /auth/v1/user at the pinned project origin.
 */
import {pinnedSupabaseProjectOrigin} from './http-transport.mjs';
import {openPrivateCloudSession} from './client-session.mjs';

export function adaptToolboxCloudAuth(toolboxAuth,{fetchImpl=globalThis.fetch}={}){
  const origin=pinnedSupabaseProjectOrigin(toolboxAuth?.url);
  const key=toolboxAuth?.key;
  const auth=toolboxAuth?.createClient?.()?.auth;
  if(typeof key!=='string'||key.length<12||key.length>4096||
     typeof fetchImpl!=='function'||typeof auth?.getSession!=='function')
    throw Error('TOOLBOX_AUTH_UNAVAILABLE');
  return Object.freeze({
    getSession:()=>auth.getSession(),
    async getUser(token){
      if(typeof token!=='string'||token.length<10||token.length>8192)
        return {data:{user:null},error:Error('UNVERIFIED')};
      try{
        const response=await fetchImpl(origin+'/auth/v1/user',{
          method:'GET',redirect:'error',credentials:'omit',cache:'no-store',
          headers:{apikey:key,Authorization:'Bearer '+token,Accept:'application/json'}
        });
        if(response?.status!==200||
          !/^application\/json(?:;|$)/i.test(response.headers?.get?.('content-type')??''))
          throw Error('UNVERIFIED');
        const raw=await response.text();
        if(raw.length<2||raw.length>16000)throw Error('UNVERIFIED');
        const user=JSON.parse(raw);
        if(!user||typeof user!=='object'||Array.isArray(user))
          throw Error('UNVERIFIED');
        return {data:{user},error:null};
      }catch{return {data:{user:null},error:Error('UNVERIFIED')}}
    }
  });
}
export async function openToolboxPrivateCloudSession({
  toolboxAuth,storage,locks,fetchImpl,clock,makeId
}={}){
  const auth=adaptToolboxCloudAuth(toolboxAuth,{fetchImpl});
  return openPrivateCloudSession({
    projectUrl:toolboxAuth.url,publishableKey:toolboxAuth.key,auth,
    storage,locks,fetchImpl,clock,makeId
  });
}
