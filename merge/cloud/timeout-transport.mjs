/** P3.2 deadline wrapper for future authenticated HTTP client transport.
 * Timeout is an UNKNOWN result, NOT proof that the server rejected a command.
 * The offline journal must retry with exactly the same operationId/revision.
 */
export class CloudNetworkTimeoutError extends Error {
  constructor(kind) { super(`Cloud ${kind} exceeded deadline; remote outcome is unknown`);
    this.name = 'CloudNetworkTimeoutError'; this.code = 'NETWORK_TIMEOUT'; }
}
const validDeadline = ms => Number.isSafeInteger(ms) && ms >= 100 && ms <= 120_000;

export function createDeadlineTransport(transport, {readTimeoutMs=12_000,
  executeTimeoutMs=15_000, setTimer=setTimeout, clearTimer=clearTimeout,
  AbortControllerClass=globalThis.AbortController} = {}) {
  if (!transport || typeof transport.read !== 'function' || typeof transport.execute !== 'function')
    throw Error('An authenticated transport with read and execute is required');
  if (!validDeadline(readTimeoutMs) || !validDeadline(executeTimeoutMs) ||
      typeof setTimer !== 'function' || typeof clearTimer !== 'function' ||
      typeof AbortControllerClass !== 'function') throw Error('Invalid network deadline configuration');

  async function bounded(kind, limitMs, fn) {
    const controller=new AbortControllerClass();
    let handle;
    const timer=new Promise((_,reject) => {
      handle=setTimer(() => {
        controller.abort();
        reject(new CloudNetworkTimeoutError(kind));
      },limitMs);
    });
    try {return await Promise.race([Promise.resolve().then(() => fn(controller.signal)),timer]);}
    finally {clearTimer(handle);}
  }
  return Object.freeze({
    read() {return bounded('read',readTimeoutMs,signal=>transport.read({signal}));},
    execute(command) {return bounded('execute',executeTimeoutMs,
      signal=>transport.execute(command,{signal}));}
  });
}