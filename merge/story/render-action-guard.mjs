/**
 * Reject queued clicks from detached story-workshop controls after a rerender.
 * This protects the meaning of a tap, not the persistence transaction:
 * callers must still run their exact-byte preflight and Web Locks/CAS checks.
 */
export function createWorkshopRenderedActionGuard(getGeneration,onStale){
  if(typeof getGeneration!=='function'||typeof onStale!=='function')
    throw new TypeError('render guard callbacks required');
  return action=>{
    if(typeof action!=='function')throw new TypeError('action callback required');
    const generation=getGeneration();
    return (...args)=>{
      if(getGeneration()!==generation){onStale();return;}
      return action(...args);
    };
  };
}
