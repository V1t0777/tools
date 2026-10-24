/** In-memory implementation of proposed PostgreSQL RPC semantics for pre-deploy tests. */
import { validateSave } from '../engine.mjs';
export function createMockRepository() {
  const users=new Map(); const queues=new Map();
  async function lock(uid, callback) {
    const previous=queues.get(uid)??Promise.resolve();
    let unlock;const pending=new Promise(resolve=>{unlock=resolve;});
    queues.set(uid,pending);await previous;
    try { return await callback(); } finally {unlock();if(queues.get(uid)===pending)queues.delete(uid);}
  }
  return {
    async open(uid, seed) {
      return lock(uid,()=>{
        if(!users.has(uid))users.set(uid,{state:structuredClone(seed),ops:new Map()});
        const row=users.get(uid);
        return {revision:row.state.revision,state:structuredClone(row.state)};
      });
    },
    async findOperation(uid,operationId) {
      return lock(uid,()=>structuredClone(users.get(uid)?.ops.get(operationId)??null));
    },
    async commit({uid,command,hash,result,now}) {
      return lock(uid,()=>{
        const row=users.get(uid);
        if(!row)throw Error('Save not initialized');
        const previous=row.ops.get(command.operationId);
        if(previous) {
          if(previous.request_hash!==hash)return {status:'rejected',code:'OPERATION_ID_REUSE',ok:false,
            revision:row.state.revision,state:structuredClone(row.state)};
          return {status:'replayed',code:previous.code,ok:previous.status==='applied',
            revision:row.state.revision,state:structuredClone(row.state),original:structuredClone(previous.response)};
        }
        if(row.state.revision!==command.expectedRevision)
          return {status:'conflict',code:'REVISION_CONFLICT',ok:false,
            revision:row.state.revision,state:structuredClone(row.state)};
        if(result.ok&&!validateSave(result.state))throw Error('Invalid transition');
        row.state=structuredClone(result.state);
        // Real SQL stores derived time only when committing a user command.
        row.ops.set(command.operationId,{request_hash:hash,status:result.ok?'applied':'rejected',
          code:result.ok?result.kind:'ACTION_NOT_ALLOWED',response:{message:result.message}});
        return {status:result.ok?'applied':'rejected',ok:result.ok,
          code:result.ok?result.kind:'ACTION_NOT_ALLOWED',revision:row.state.revision,
          state:structuredClone(row.state),original:{message:result.message}};
      });
    }
  };
}