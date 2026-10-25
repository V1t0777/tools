# 《云屿百物铺》V3 · P2.55 同步发布期间的重入失效防护（未发布）

## 问题
P2.54 已拒绝异步 `publish()` 回调，但同步回调仍可能在执行期间调用事务门禁的 `block()` 或 `invalidate()`。此前 `run()` 在同步回调返回后直接报告 `UI_PUBLISHED`，即使该门禁已被阻断或事务纪元改变，可能使上层错误地认为界面与存档状态仍可信。

## 最小改动
仅修改 `merge/normal-ui-flight.mjs` 的同步发布回调结束路径。回调执行完毕后再次检查永久阻断标志与事务纪元：已经 `block()` 的返回 `UI_SAVE_BLOCKED`；已经 `invalidate()` 的执行永久阻断并返回 `UI_TRANSACTION_INVALIDATED`。这两种情况均不报告成功，也不尝试回滚已发生的 DOM 副作用。正常同步发布仍返回 `UI_PUBLISHED`，在发布回调内部重入的第二次事务仍被单飞门禁拒绝。

## 专项验证
`tests/merge-normal-ui-flight.test.mjs` 增加三项回归：发布回调内部永久阻断、发布回调内部失效、发布回调内部重复发起事务。必须以本轮提交 HEAD 对应的全仓库回归、静态安全与部署隔离、完整 Git 历史密钥扫描为准；失败先修复，未全部通过不得标记完成。

## 剩余限制
P2.55 仍是独立安全边界模块，尚未接入 `merge/main.mjs`。启动迁移、游戏动作、每秒计时器、异常备份与确认重置必须统一持同名 Web Lock 后，才可声称实际页面具备端到端跨标签互斥。模拟单元测试不等于真实双标签、iPhone Safari、微信 WebView 或线上 PostgreSQL/Edge 验收。

PR #58/#59 保持 Open/Draft；不修改 `main`、正式导航或部署白名单，不发布、不操作线上 Supabase、不增加美术或作弊后门。
