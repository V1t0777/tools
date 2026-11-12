# 云屿百物铺 P3.1 — 离线操作队列与冲突恢复（研发分支）

**状态：未发布，未部署数据库，未接入线上云存档，未修改正式游戏入口。** 此轮不开展美术生产。

## 交付内容

- `merge/cloud/offline-queue.mjs`：客户端独立操作日志，不修改 P2 试玩档，也不导入试玩所得物资。
- `merge/cloud/sync-view.mjs`：中文云同步状态文字（缓存、离线、连接中、已确认、冲突、拒绝、异常）。**UI 纯状态模块，尚未接入正式游戏页面。**
- `tests/merge-offline-queue.test.mjs`：离线、网络响应丢失、固定幂等编号、并发重试、断电重建、跨设备冲突、跨用户浏览器缓存隔离、持久化失败保护、UI 状态的可重复测试。

## 严格协议

客户端仅缓存未来提交给服务端的 `{operationId, expectedRevision, action}`，不会提交本地计算的金币、体力、掉落随机数或完整新存档。命令先持久化后发送，绑定同一浏览器中的有效 Supabase 已验证账户；在加载缓存时，用户身份必须由认证模块提供，严禁从保存的数据自行登录。实际鉴权和操作校验始终由服务端完成。

1. 离线可入队白名单命令，最大 32 项；不能把未确认奖励作为已入账资源。
2. 首次发送时写入当时可信云档的 `expectedRevision` 和固定 UUID，并持久化发送尝试，再开始网络调用。
3. 超时和未知网络结果：**原封不动**重试同一个 operationId 与 expectedRevision，采用上限 60 秒的指数退避；不能重新生成编号，否则会双扣体力。
4. 服务器返回 `applied` 或成功 `replayed` 且快照合法时，才确认出队；必须检查返回 `revision` 不倒退。
5. `conflict`：保留服务器最新权威快照与全部待决队列，冻结重试，不自动重定基准版本；只有用户确认放弃整个有依赖关系的待发命令链，才清除冲突队列。
6. `rejected`：保留整个队列供检查，不跳过错误操作继续发送。
7. 无法写入 localStorage：停止发送。损坏缓存不静默清空；可能已发送的操作禁止直接取消，防止用户误认为没结算而重试新编号。
8. 浏览器重新启动后已保存的快照标记为**未校验**，必须经服务器读档验证才显示为已确认。

## 示例调用（**开发设计，非现网接入**）

```js
const queue = createOfflineCommandQueue({
  uid: verifiedSession.user.id,
  storage: window.localStorage,
  transport: {
    read: () => authenticatedMergeApi.read(),
    execute: command => authenticatedMergeApi.execute(command)
  }
});
// 只有在未来的 Edge Function 已经过认证、安全、数据库联调后才可以启用。
const pending = queue.enqueue({ type: 'move', from: 0, to: 2 });
// 网络恢复时主动调用；如发生冲突，UI 必须提醒用户确认，绝不可自动清空。
const outcome = await queue.flush();
```

## 风险与上线阻塞项

- 当前仅有模拟事务；**没有真实 Supabase 服务器，不能声称已支持跨设备在线存档。**
- 本地队列默认依赖浏览器 `localStorage`，可能被隐私模式和配额禁用；实际大规模本地数据应评估 IndexedDB，并增加持久性与清理检测。
- 多标签页可能同时写同一 localStorage 队列：应用接入前需用 Web Locks / BroadcastChannel 加独占协调与跨标签刷新，或退化为单一标签发送；服务端幂等不能自动解决本地队列写入丢失。
- 后端必须校验调用者身份、JWT、有权限的业务成员；不能根据客户端提交的 UID 切换用户。
- 需在隔离库证明 RLS、RPC grant/deny、真正数据库 `FOR UPDATE` 与 CAS 正确；目前的 SQL 是 NOT-APPLIED 草案。
- 当前无自动重连定时器：需在 UI 层根据 `nextRetryAt`、`online` 和 `visibilitychange` 安排尝试，并确保不会在后台持续忙轮询。
- 发送超时必须通过 transport 层的 `AbortSignal` 实现，不能让永不结束的网络 Promise 持续占用队列。
- P2 游客单机档与 P3 权威经济不可直接合并；必须设计明确迁移/放弃流程。
- 目前是模块原型，并非完整浏览器端到端验证；iOS Safari、微信内置浏览器实测和破坏性测试待完成。

## 验证

`node --test tests/merge-offline-queue.test.mjs`

在 Draft PR 上继续执行 `node --test tests/*.test.mjs scripts/*.test.cjs` 与 `bash scripts/security-check.sh`。PR 所有检查通过也**不能**视为发布授权。未经用户明确允许，不执行 SQL、不部署 Edge Function、不发布站点、不合并 main。