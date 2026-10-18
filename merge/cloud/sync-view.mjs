/** P3.1 pure UI status labels; presentation only, no account or network side effects. */
export function formatCloudSyncStatus(status) {
  if (!status || typeof status !== 'object') return { tone:'warning', title:'云端状态未知', detail:'尚未验证远端存档' };
  if (status.phase === 'storage-error') return {tone:'danger',title:'本地队列无法安全保存',detail:'已暂停发送；请勿清理浏览器数据'};
  if (status.phase === 'protocol-error') return {tone:'danger',title:'存档响应异常',detail:'已停止自动重试，防止错误覆盖'};
  if (status.blocked === 'conflict') return {tone:'warning',title:'其他设备已更新进度',detail:`${status.pending} 个操作待确认；不会自动覆盖云端进度`};
  if (status.blocked === 'rejected') return {tone:'warning',title:'操作需要人工处理',detail:`${status.pending} 个操作暂停；不能自动补发或领取奖励`};
  if (status.blocked) return {tone:'danger',title:'云端校验未通过',detail:'保留队列，需人工检查后才能继续'};
  if (status.phase === 'offline') return {tone:'warning',title:'连接暂不可用',detail:`${status.pending} 个操作保留在此设备；未确认的奖励不会计入云端`};
  if (status.phase === 'syncing') return {tone:'info',title:'正在核对云端存档',detail:'不覆盖未经服务端确认的进度'};
  if (status.pending > 0) return {tone:'info',title:'待同步操作',detail:`${status.pending} 个操作尚未由服务器确认`};
  if (status.phase === 'synced' && status.verified) return {tone:'success',title:'云端进度已确认',detail:`已校验版本 ${status.revision}`};
  return {tone:'muted',title:'等待连接云存档',detail:'当前仅能显示本设备缓存；尚未从服务器验证'};
}