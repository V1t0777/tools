# 云屿百物铺 P3.2.1 — 多设备冲突人工恢复（未发布研发模块）

**范围：** 只修改离线云指令队列、跨标签协调器、中文状态文案及测试；不修改 P2 试玩界面、游戏经济、数据库草案、生产部署和美术。该模块尚未接入线上 Supabase。

## 问题与原则

P3.1–P3.2 在 `REVISION_CONFLICT` 时安全冻结队列，但只能整队放弃，无法在用户检查最新存档后保留明确想做的新操作。直接更改原指令的 `expectedRevision` 极其危险：原来的棋盘坐标可能已指向另一件物品，订单和生产器状态也可能改变。**因此绝不自动重放冲突指令，也不自动改写其 revision。**

## 本次实现

- `createOfflineCommandQueue().inspectConflict()`：仅在**本次页面会话已从服务器核验**且当前处于冲突冻结状态时，提供原操作编号、原动作、当前权威快照副本、revision、待处理数量和后续指令是否均未发送。返回值深拷贝，不可篡改队列。页面重启后必须先 `connect()`。
- `replaceConflicted({confirmedByUser,originalOperationId,expectedRevision,newAction,discardFollowing})`：用户核对最新权威快照后，**重新选择新动作**。需要显式确认、匹配原指令 ID 和所见 revision，严格校验动作白名单；多条后续指令存在时，必须另行明确 `discardFollowing:true`，且所有后续指令均尚未发送。
- 真正替换前**重新从服务器读取**：若另一设备又提交了操作，返回 `REVIEW_STALE` 并保留冲突队列，要求重新核对。网络中断或本地持久化失败同样保留原队列，不发送新指令。
- 只有确认通过时，才把冲突指令及已获授权丢弃的后续指令替换为**一个新的待发动作**，生成新 `operationId`，`expectedRevision:null`、`attempts:0`，不立即调用服务端 `execute`；后续 `flush()` 才按最新服务器 revision 提交。
- `createCoordinatedCloudQueue()` 新增对应入口；检查、重读、替换在同一 Web Lock 内执行，避免同源多个标签页的本地覆盖。`sync-view.mjs` 文案强调先核对物品再选择取消或重新发起。

## 推荐交互（仅 API 设计，UI 未接入）

1. 云端返回 `REVISION_CONFLICT`，冻结队列，提示用户查看最新权威棋盘和原操作意图。
2. 在受 Web Lock 保护的协调器上调用 `inspectConflict()`；用只读 UI 展示当前云端状态及原动作，不自动合成/领取奖励。
3. 用户可使用既有 `discardConflicted({confirmedByUser:true})` 放弃整队，或在**当前棋盘上重新明确选择**一个 `newAction` 后调用 `replaceConflicted(...)`。后续队列不默认保留，以免旧依赖链误操作。
4. 若返回 `REVIEW_STALE`，必须重新查看新 revision；若网络或存储错误，保持冻结并提示用户不要清除浏览器缓存。
5. 只有新的队列动作经 `flush()` 获得权威成功回执后，才显示已同步；服务端幂等去重和 CAS 仍为最终安全边界。

## 已覆盖测试

`tests/merge-cloud-conflict-recovery.test.mjs` 新增 10 项：原动作/快照防篡改、无确认拒绝、白名单、显式替换与新 ID、确认期间跨设备版本变化、后续依赖队列处理、网络断开、重启核验、存储失败、跨标签锁与状态文案。与原 91 项合计 **101 项 Node 测试本地通过**。

复现：

```bash
node --test tests/merge-*.test.mjs
bash scripts/security-check.sh
```

第二项安全门禁以 GitHub Actions 中完整仓库的实际运行结果为准，不能用本地子集替代。

## 剩余风险和发布阻塞

- 当前仍为**未接入正式 UI 的离线研发模块**；无法声称跨设备冲突恢复已供玩家使用。
- `inspectConflict` 的“已核验”仅代表本次会话曾成功读档；两次读档之间仍可能有其他设备更新。替换前的强制重读和最终服务端 CAS 分别承担校验与并发保护。
- 服务器是否真实实现幂等、行锁、JWT、RLS 尚未通过 Supabase 实机验证；模拟器不等于生产安全性证明。
- 不支持 Web Locks 的浏览器会阻断写入；需要后续在微信内置浏览器、iOS Safari、多标签、断网与页面崩溃下做端到端验收。
- 原冲突操作被明确放弃后不会继续保留在队列中；未来可设计**不含敏感信息**的有限本地审计记录，但不能将其当作可重试指令。

**严格禁止未经授权发布：** PR 保持 Draft，不合并 `main`，不修改导航/部署白名单，不部署 GitHub Pages/Cloudflare/Edge，不执行线上 Supabase SQL/迁移，不推进美术。