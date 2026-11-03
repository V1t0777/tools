# 《云屿百物铺》P3.9 — 冲突恢复确认必须绑定完整快照（未发布）

## 目标及修复范围

本轮只修复未来云存档客户端的冲突恢复确认路径，保持原 P2 本地试玩、页面导航、部署白名单、数据库与美术不变。所有云端交互均由纯内存模拟权威端测试，不对线上 Supabase 读写，也不部署 Edge Function。

原 `merge/cloud/offline-queue.mjs` 的 `replaceConflicted()` 在用户检查冲突后，重新读取权威存档仅比较 `expectedRevision`。假如体力自然恢复等操作改变了同 revision 的快照内容，则用户刚确认的旧棋盘/资源状态已经过期，却可能继续入队替代操作。

## 行为契约

- `inspectConflict()` 已返回经过深拷贝的 `state`；调用方必须在用户看过并确认后，将**同一份已审核内容**作为 `replaceConflicted({reviewedState, ...})` 的参数。缺少、非法或未经确认的快照必须拒绝，不能回退到仅比较 revision。
- 在发起远端核对**之前**，对比 `reviewedState` 与最新队列持久化快照；若另一标签页已经用相同 revision 更新缓存，则返回 `REVIEW_STALE`。
- 在持有同源 Web Lock 的前提下再读服务端状态，分别检查 **revision 与完整快照内容**。即便 revision 未变化，若服务器状态内容不同也返回 `REVIEW_STALE`，保留原 operationId、未决指令及 `blocked:'conflict'`，要求用户重新审核。
- 只有两次比较都一致、原操作及后续链条具备明确用户许可时，才能持久化一个**全新** operationId 的未发送替代操作。此步骤绝不直接发送网络写入；必须单独调用 `flush()`。
- 快照比较采用 `JSON.stringify()` 精确比对已通过 `validateSave()` 的有限结构。不同对象键顺序可能保守拒绝，即误拒绝而非静默接受；它不是密码学签名或身份验证。

## 测试

更新既有 `tests/merge-cloud-conflict-recovery.test.mjs` 使所有正常确认路径都传入 `reviewedState`，并增加三项回归：

1. 用户审核后服务器返回同 revision、不同内容：停止替代操作、保留原始冲突；重新审核新快照后允许创建新操作，但不自动发送。
2. 缺少或篡改 `reviewedState`：拒绝创建替代操作，未决操作与服务器发送次数不变。
3. 第二个标签页已写入同 revision 的新权威快照：第一个标签页凭旧审核状态尝试替代，被协调器拒绝且原始指令不丢失。

仓库验收命令：

```sh
node --test tests/merge-cloud-conflict-recovery.test.mjs
node --test tests/*.test.mjs scripts/*.test.cjs
bash scripts/security-check.sh
```

## 剩余风险

- 这仅保证确认对应最近已获取的**精确快照**，无法保证用户确认后、下一次服务端 CAS 前远端不再变化；真实并发仍须后端事务与 revision CAS/幂等操作日志。
- 本地 `reviewedState` 不是安全凭证；不得据此信任本地金币、物品或绕过服务端身份验证。
- Web Locks 只协调同源参与的客户端标签；跨设备必须由服务器权威实现仲裁。浏览器缺少 Web Locks 时继续 fail-closed。
- 需在真实 iPhone Safari、微信 WebView、断网/恢复、后台终止、双设备负载下进行端到端验收。
- **用户未授权发布前，PR #58 保持 Draft；绝不合并 main，不修改正式工具箱导航及部署白名单，不发布 Pages/Cloudflare，不执行 Supabase 线上 SQL/迁移，不部署 Edge Function，也不推进美术素材。**
