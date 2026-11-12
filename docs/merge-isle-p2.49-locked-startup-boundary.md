# 《云屿百物铺》V3 · P2.49 普通模式启动持锁事务边界（未发布）

## 本轮目标

在 `merge/normal-startup-transaction.mjs` 新增 `prepareNormalStartupWithLock()`，为**后续**普通模式页面整体异步启动提供统一持锁边界。保留原有 `loadLocal()`、`prepareNormalStartup()` 的既有语义，不修改 `merge/main.mjs`，不调整正式部署入口、存档格式或经济参数。

**关键发现：** `loadLocal()` 在遇到合法 V1/V2 存档时并非纯读取；它会写入原始备份键并执行迁移。仅给 `prepareNormalStartup()` 加锁会遗漏迁移写入。本轮因此将**两者放在同一 Web Lock 回调内**，与 P2.45—P2.48 的游戏动作、计时器及重置使用相同锁名。

## 安全规则

- 无 Web Locks、锁忙、时钟非法或存储不可用时拒绝，不使用 `localStorage` 自旋锁或退回同步无锁保存。
- 首次启动只有在确切确认不存在旧存档后，才创建并读回 V3 初始存档。
- 合法 V3 存档没有时间变化时不重复写盘，保留原始 JSON 字节；有体力恢复时保存并验证后才返回状态。
- 合法 V1/V2 存档由现有迁移路径先保留原始字节备份、再迁移并读回。备份冲突或失败时禁止自动覆盖原始数据。
- 最终统一复查 `SAVE_KEY` 是否仍等于可信原始字节基线。任何不确定结果都不返回可供 UI 发布的 `state`。
- 仅操作普通模式存档，不写剧情模式命名空间、不访问云端。

## 验证范围

新增 `tests/merge-normal-startup-transaction.test.mjs`，覆盖首次存档、已有 V3 无变化零写入、体力恢复、V1 迁移与原始备份、备份失败、损坏存档、无锁与锁忙、读回异常、静默写失败、剧情模式隔离及非法时钟。

本模块**尚未接入实际页面**。页面当前仍同步执行 `loadLocal()` 和 `prepareNormalStartup()`，并保留同步 `persist()` 写入。因此不得将本模块的测试成功描述为真实浏览器跨标签原子性已经达成；尚未完成 iPhone Safari、微信 WebView、真实双标签、真实 PostgreSQL 或 Edge 验收。

后续需先设计异步初始化期间 UI 禁用/阻塞、旧手势取消及所有普通模式写入入口同时迁移的最小安全切换；不能只把启动模块单独接入，留下旧计时器、重置或游戏操作无锁写入。

## 发布隔离

PR #58/#59 保持 Open/Draft；不合并 main、不发布 GitHub Pages/Cloudflare/Edge、不改导航或部署白名单、不执行线上 Supabase SQL/迁移、不制作美术或作弊后门。
