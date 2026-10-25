# 《云屿百物铺》V3 · P2.60 普通模式历史恢复锁名统一（未发布）

## 发现与修复
P2.21 的 `save-restore-lock.mjs` 使用 `toolbox.merge-isle.normal.restore.v1`，P2.22 的 `save-write-lock.mjs` 沿用此名称；但 P2.45–P2.57 的启动、动作、计时器、重置统一使用 `toolbox.merge-isle.normal-save.write-v1`。这两组独占 Web Locks **互不排斥**，即使未来页面接线完成，导入恢复与正常游戏写入也可能同时进入临界区。

本轮只将 `RESTORE_LOCK_NAME` 复用 P2.45 的 `NORMAL_SAVE_LOCK_NAME`，P2.22 原有别名自动同步。没有更改恢复确认、原始备份、CAS、存档格式、经济、UI、导航或部署。旧适配器此前未接入正式页面；若将来存在旧标签页运行旧代码，仍须依靠原始字节基线防护并提示刷新，不得声称跨版本互斥。

## 专项验证
`tests/merge-normal-lock-name-unification.test.mjs` 检查三组锁名完全相同；用同一模拟锁管理器验证恢复持锁时游戏动作拒绝、恢复后旧基线拒绝，以及动作持锁时恢复不产生备份或覆盖。该模拟仅验证参与同名锁的 JavaScript 事务，不代表真实浏览器或跨标签端到端验收。

专项：`node --test tests/merge-normal-lock-name-unification.test.mjs tests/merge-save-write-lock.test.mjs tests/merge-save-restore-lock.test.mjs tests/merge-normal-write-coordination.test.mjs`。
全仓库：`node --test tests/*.test.mjs`；安全：`bash scripts/security-check.sh`。**必须以本次最新 HEAD 的 GitHub Actions 三项全部成功为准**，未通过不得标记完成。

## 未解决的发布阻塞
`merge/main.mjs` 仍使用同步、未持锁的 `persist()`，启动迁移、动作、计时器、重置必须统一迁入异步事务后才可能宣称普通模式跨标签原子协调。Web Locks 不支持时必须安全阻断，不能回退到 localStorage 假锁；仍缺真实 iPhone Safari、微信 WebView、多标签和实际数据库/Edge 验收。

PR #58/#59 保持 Open/Draft；不得合并 main、发布 Pages/Cloudflare/Edge、改导航或部署白名单、执行线上 Supabase SQL/迁移、制作美术或作弊后门。
