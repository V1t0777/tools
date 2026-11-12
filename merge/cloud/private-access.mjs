/** P3 draft: cloud-save access is granted by verified Auth UID, never a
 * client nickname, request body, or mutable user_metadata.
 * The server-only lookup must read the durable four-account allowlist.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=code=>Object.freeze({ok:false,code});

export async function authorizeFourAccountCloudSave(user,lookupAllowedUid){
  if(!user||typeof user.id!=='string'||!UUID.test(user.id))
    return deny('AUTH_REQUIRED');
  if(user.is_anonymous===true||
     typeof user.email_confirmed_at!=='string'||
     !user.email_confirmed_at.trim())
    return deny('CLOUD_ACCESS_DENIED');
  if(typeof lookupAllowedUid!=='function')
    return deny('CLOUD_ACCESS_UNAVAILABLE');
  try{
    // Only an explicit boolean true from a trusted server-side user_id match
    // authorizes the request. A missing table or failed query never permits it.
    if(await lookupAllowedUid(user.id)!==true)
      return deny('CLOUD_ACCESS_DENIED');
  }catch{return deny('CLOUD_ACCESS_UNAVAILABLE');}
  return Object.freeze({ok:true,uid:user.id});
}
