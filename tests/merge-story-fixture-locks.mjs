/** Per-fixture same-origin Web Locks stand-in for positive-path DOM tests.
 * Never used by runtime. No-lock cases pass null and assert zero writes.
 */
export function createStoryTestLocks(){
  const pending=new Map();
  return {request(name,options,callback){
    if(typeof name!=='string'||options?.mode!=='exclusive'||typeof callback!=='function')
      return Promise.reject(new Error('invalid lock request'));
    const prior=pending.get(name)??Promise.resolve();
    const current=prior.then(callback,callback);
    pending.set(name,current.then(()=>undefined,()=>undefined));
    return current;
  }};
}
