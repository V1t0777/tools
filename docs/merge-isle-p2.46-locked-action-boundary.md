# 《云屿百物铺》V3 · P2.46 持锁游戏动作与存档读回边界（未发布）

## 本轮增量
新增 `merge/normal-action-transaction.mjs`，将 P2.45 的独占 Web Lock、P2.25 的只读原始存档检查与 P2.26 的写后精确读回串为一个**未接入当前页面**的普通模式动作提交边界。动作函数在拿到锁、重新读取完整 V3 存档且确认与调用方原始字节基线完全一致后才执行；不支持异步动作。保存和读回验证失败时不返回可发布的新状态。无 Web Locks、锁忙、存档缺失/损坏、基线陈旧均拒绝。

## 实际写入入口审计（下一阶段接入前必须解决）
- `merge/main.mjs`：`commit()` 下的全部游戏动作、每秒体力/冷却计时器、确认重置共用同步 `persist()`，尚未持锁。
- `merge/main.mjs` 模块顶层：`loadLocal()` 的 V1/V2 备份与迁移写入，以及 `prepareNormalStartup()` 的初始存档/时间推进写入，都发生在 UI 事件绑定前，尚未持锁。
- `merge/reset-backup.mjs`：异常重置前独立备份键的写入与精确读回，尚未持锁；必须与重置操作使用同一锁。
- `merge/storage.mjs`：`saveLocal()` 负责基线比较及底层 `setItem`，它自身不是跨标签原子事务；`merge/save-transaction.mjs` 提供写后读回。
- `storage` 事件处理只读，不能用事件回调代替互斥；剧情模式与未来云队列使用独立命名空间及不同锁，不得混用。

## 回归与限制
`node --test tests/merge-normal-action-transaction.test.mjs` 覆盖真实 V3 引擎动作、跨标签锁忙、陈旧原始字节、损坏存档、异步/失败动作、无锁、无锁参与者插入写入及读回不一致。必须以**本提交 SHA** 的全仓库回归、静态安全/部署隔离、完整历史密钥扫描三项 CI 为准。

本轮**没有修改 `merge/main.mjs`，不能宣称当前试玩已解决跨标签写入竞争**。下一轮应设计页面异步动作的 UI 忙碌态及过期手势阻断，并将启动迁移、重置备份、计时器等全部写入入口纳入同名锁；不支持 Web Locks 时必须安全阻断，而不是使用 localStorage 假锁。真实双标签、iPhone Safari、微信 WebView、PostgreSQL/Edge 均未验收。

PR #58/#59 保持 Open/Draft；不合并 main、不发布、不修改正式导航或部署白名单、不执行线上 SQL/迁移、不部署 Edge、不制作美术或作弊后门。
