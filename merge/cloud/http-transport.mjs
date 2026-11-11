/** P3 private cloud fetch adapter. Never uploads local sandbox state.
 * Revalidates session identity per request and pins the bearer endpoint.
 */
import {normalizeCommand} from './authority.mjs';
export class CloudAuthError extends Error {
  constructor(code){super(code);this.name='CloudAuthError';this.code=code;}
}
const UID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
function endpoint(projectUrl){
  if(typeof projectUrl!=='string')throw Error('INVALID_CLOUD_PROJECT');
  let uri;
  try{uri=new URL(projectUrl);}catch{throw Error('INVALID_CLOUD_PROJECT');}
  if(uri.protocol!=='https:'||!(/^[a-z0-9-]+\.supabase\.co$/i).test(uri.hostname)||
     uri.username||uri.password||uri.port||uri.pathname!=='/'||
     uri.search||uri.hash||uri.origin!==projectUrl.replace(/\/$/,''))
    throw Error('INVALID_CLOUD_PROJECT');
  return uri.origin+'/functions/v1/merge-game';
}
export async function verifyCloudIdentity(auth){
  if(typeof auth?.getSession!=='function'||typeof auth?.getUser!=='function')
    throw new CloudAuthError('CLOUD_AUTH_UNVERIFIED');
  let session,user;
  try{
    const received=await auth.getSession();
    if(received?.error)throw Error('Invalid session');
    session=received?.data?.session;
    const token=session?.access_token;
    if(typeof token!=='string'||token.length<10||token.length>8192)
      throw Error('Bearer missing');
    const verified=await auth.getUser(token);
    if(verified?.error)throw Error('Verification failed');
    user=verified?.data?.user;
  }catch{throw new CloudAuthError('CLOUD_AUTH_UNVERIFIED');}
  if(typeof user?.id!=='string'||!UID.test(user.id)||user.is_anonymous===true||
     typeof user.email_confirmed_at!=='string'||!user.email_confirmed_at||
     session.user?.id!==user.id)throw new CloudAuthError('CLOUD_AUTH_UNVERIFIED');
  return {uid:user.id.toLowerCase(),token:session.access_token};
}
export function createAuthenticatedMergeTransport({
  projectUrl,publishableKey,auth,verifiedUid,fetchImpl=globalThis.fetch
}={}){
  const url=endpoint(projectUrl);
  if(typeof publishableKey!=='string'||publishableKey.length<12||
     publishableKey.length>4096||/\s/.test(publishableKey)||
     typeof fetchImpl!=='function'||typeof verifiedUid!=='string'||
     !UID.test(verifiedUid))throw Error('INVALID_CLOUD_TRANSPORT');
  const bound=verifiedUid.toLowerCase();
  async function send(body,{signal}={}){
    if(signal?.aborted)throw Error('CLOUD_CANCELLED');
    const {uid,token}=await verifyCloudIdentity(auth);
    if(uid!==bound)throw new CloudAuthError('CLOUD_AUTH_UNVERIFIED');
    const encoded=JSON.stringify(body);
    if(new TextEncoder().encode(encoded).length>4096)
      throw Error('CLOUD_REQUEST_TOO_LARGE');
    const response=await fetchImpl(url,{
      method:'POST',redirect:'error',credentials:'omit',cache:'no-store',
      signal,headers:{Authorization:'Bearer '+token,apikey:publishableKey,
        'Content-Type':'application/json',Accept:'application/json'},body:encoded
    });
    if(response?.status===401||response?.status===403)
      throw new CloudAuthError('CLOUD_ACCESS_DENIED');
    if(!response||![200,409].includes(response.status))
      throw Error('CLOUD_REMOTE_UNAVAILABLE');
    if(!/^application\/json(?:;|$)/i.test(response.headers?.get?.('content-type')??''))
      throw Error('CLOUD_INVALID_RESPONSE');
    const raw=await response.text();
    if(raw.length<2||raw.length>1000000)throw Error('CLOUD_INVALID_RESPONSE');
    let parsed;
    try{parsed=JSON.parse(raw)}catch{throw Error('CLOUD_INVALID_RESPONSE')}
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
       typeof parsed.status!=='string')throw Error('CLOUD_INVALID_RESPONSE');
    return parsed;
  }
  return Object.freeze({
    read(options){return send({mode:'read'},options)},
    execute(command,options){
      if(!normalizeCommand(command))return Promise.reject(Error('BAD_CLOUD_COMMAND'));
      return send({mode:'command',command},options);
    }
  });
}
