export function validateReceiptRow(row) {
  try {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) return null;
    const prototype = Object.getPrototypeOf(row);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const hash = Object.getOwnPropertyDescriptor(row, 'request_hash');
    const status = Object.getOwnPropertyDescriptor(row, 'status');
    if (!hash || !status || !('value' in hash) || !('value' in status)) return null;
    if (typeof hash.value !== 'string' || !/^[0-9a-f]{64}$/.test(hash.value)) return null;
    if (status.value !== 'applied' && status.value !== 'rejected') return null;
    return Object.freeze({request_hash:hash.value,status:status.value});
  } catch {
    return null;
  }
}
