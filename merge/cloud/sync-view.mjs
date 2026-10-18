/** P3.2 pure, accessible cloud synchronization status presentation.
 * No account/session side effects and never guesses the outcome of a timeout.
 */
export function formatCloudSyncStatus(status) {
  if (!status || typeof status !== 'object')
    return {tone:'warning',title:'云端状态未知',detail:'尚未验证远端存档'};
  if (status.lockAvailable === false || status.code === 'MULTITAB_LOCK_UNAVAILABLE')
    return {tone:'danger',title:'此浏览器暂不支持安全云同步',detail:'已停止云端写入；请使用支持 Web Locks 的浏览器'};
  if (status.code === 'LOCK_REQUEST_FAILED')
    return {tone:'danger',title:'无法获取云存档独占锁',detail:'已暂停写入，避免其他标签页进度被覆盖'};
  if (status.phase === 'storage-error')
    return {tone:'danger',title:'本地队列无法安全保存',detail:'已暂停发送；请勿清理浏览器数据'};
  if (status.phase === 'protocol-error')
    return {tone:'danger',title:'存档响应异常',detail:'已停止自动重试，防止错误覆盖'};
  if (status.blocked === 'conflict')
    return {tone:'warning',title:'其他设备已更新进度',detail:`${status.pending} 个操作待确认；请先核对最新云端物品，再选择取消或重新发起新操作`};
  if (status.blocked === 'rejected')
    return {tone:'warning',title:'操作需要人工处理',detail:`${status.pending} 个操作暂停；不能自动补发或领取奖励`};
  if (status.blocked)
    return {tone:'danger',title:'云端校验未通过',detail:'保留队列，需人工检查后才能继续'};
  if (status.phase === 'offline')
    return {tone:'warning',title:'连接暂不可用',detail:`${status.pending} 个操作保留在此设备；未确认的奖励不会计入云端`};
  if (status.phase === 'syncing')
    return {tone:'info',title:'正在核对云端存档',detail:'不覆盖未经服务端确认的进度'};
  if (status.pending > 0)
    return {tone:'info',title:'待同步操作',detail:`${status.pending} 个操作尚未由服务器确认`};
  if (status.phase === 'synced' && status.verified)
    return {tone:'success',title:'云端进度已确认',detail:`已校验版本 ${status.revision}`};
  return {tone:'muted',title:'等待连接云存档',detail:'当前仅能显示本设备缓存；尚未从服务器验证'};
}

/** View-only integration hook; do not attach this to the P2 sandbox without a real cloud client. */
export function paintCloudSyncStatus(element, status) {
  if (!element || typeof element.setAttribute !== 'function') throw Error('Status container is required');
  const presentation=formatCloudSyncStatus(status);
  element.textContent=`${presentation.title}。${presentation.detail}`;
  element.setAttribute('role','status');
  element.setAttribute('aria-live','polite');
  element.setAttribute('data-sync-tone',presentation.tone);
  return presentation;
}