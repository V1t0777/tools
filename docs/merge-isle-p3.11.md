# 《云屿百物铺》P3.11：重启后未决指令的可信状态展示（仅开发分支）

> **发布边界**：P3.11 是未来云存档客户端的只读状态增强；未接入目前 P2 本地试玩、不访问真实 Supabase、不执行线上 SQL/迁移、不部署 Edge Function、Pages 或 Cloudflare，不修改正式工具箱导航/部署白名单，不推进美术素材。PR #58 必须保留 Draft，未经明确授权不得合并 main。

## 风险与修复

P3.10 已验证网络超时、提交后确认丢失、浏览器拒绝保存等场景，且所有已尝试发送的指令在持久化 journal 中保留 `attempts`、`operationId`、`expectedRevision` 和 `nextRetryAt`。但先前 P3.2 的中文同步状态展示只看 `phase` / `pending`，重启后 `phase` 回到 `unverified`，可能把**服务器已提交但客户端未收到确认**的操作误显示为普通“待同步操作”，用户不易发现重新提交、双领或覆盖风险。

本轮不增加新的持久化字段、不改变 journal 格式，也不更改服务端协议：

1. `merge/cloud/offline-queue.mjs` 的 `status()` 额外只读返回 `attemptedPending`：当前未决操作中 `attempts > 0` 的数量。该信息直接从已验证的持久化 journal 计算，重启后也能恢复。**已尝试 ≠ 服务端已成功或已失败。**
2. `merge/cloud/sync-view.mjs` 将 `attemptedPending > 0` 与 `nextRetryAt`、`phase` 联合展示，明确标记“操作结果未确认”；在重试截止时间未到时显示相应提示；保留原操作编号，不能重复提交或把不确定的奖励标为已到账。
3. 普通 `attempts === 0` 待发操作依旧是信息级，不虚构服务端执行。确认读取远端快照并不等于曾经发出的**操作已得到幂等回应**，已尝试未决操作依旧保持警告，直到服务端重放确认并成功持久化后才可显示“云端进度已确认”。
4. 重启后若存在 `blocked:'conflict'` 且尚未完成本次会话的服务器验证，改为“本地冲突记录待核对”，不将旧缓存伪装为刚核验的最新状态；`blocked:'rejected'` 仍提示人工处理。
5. 存储错误、协议错误、锁不可用、锁请求失败均比普通待决状态优先，绝不以“已确认”掩盖故障；状态显示继续使用纯文本、无障碍 `role=status` / `aria-live`，不增加 HTML 解析或外部连接。

## 验证

新增 `tests/merge-cloud-recovery-status.test.mjs` 11 项全离线测试，使用内存存储桩和 `createInMemoryAuthority()`，覆盖：

- 首次待发操作与已尝试发送、未决结果的区别
- 丢失 ACK 后的重启、原始操作 ID 和持久化退避截止时间
- 仅 `connect()` 读到快照不能宣称操作成功；原 ID 幂等重放并落盘后才变绿
- 冲突记录重启后先提示核验；拒绝操作继续提示人工处理
- 发送前断网不应误标为“可能已在服务端执行”
- journal 损坏及 Web Locks 缺失的阻断优先级
- 文字渲染的无障碍属性和未决指令重验过程

运行：

```sh
node --test tests/merge-cloud-recovery-status.test.mjs
node --test tests/*.test.mjs scripts/*.test.cjs
bash scripts/security-check.sh
```

所有 CI 项目，包括完整 Git 历史密钥扫描，必须全部成功才算通过仓库验收。

## 剩余风险

- 此状态仅根据本地持久化记录判定**有无未决发送尝试**，无法通过本地缓存确认服务器是否真的执行了操作；必须对原 `operationId` 进行服务端幂等重放核验。真实服务端事务 CAS/RLS、日志清理仍待部署前安全验证。
- `formatCloudSyncStatus(status, now)` 可以显示是否已过退避截止，但不会自行调度后台重试、启动网络或承诺重试成功；真实前端接入及网络状态管理待后续完成。
- 浏览器真正断电/数据被清理时可能丢失 localStorage；无法替代服务端持久幂等日志。已损坏的 journal 仍保留原始字节并阻断自动操作。
- iOS Safari、微信 WebView、同源多标签 Web Locks、跨设备和弱网等真实端到端验收尚未开展，不代表云存档已可上线。
