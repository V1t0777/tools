# 《云屿百物铺》V3 · P2.54 异步页面发布回调安全阻断（未发布）

## 本轮问题
`merge/normal-ui-flight.mjs` 已要求持锁事务返回已验证的 `state/raw` 回执，但 `publish()` 回调原先只通过同步 `try/catch` 检查异常。如果调用方传入 `async` 函数，回调返回 Promise 后门禁可能立即报告 `UI_PUBLISHED`；其后发生的拒绝无法被同步捕获，造成错误的成功状态。

## 最小修复
保留同步发布兼容性，检查 `publish()` 返回值是否为 thenable。如果是，返回 `UI_ASYNC_PUBLISH_NOT_ALLOWED`、永久阻断该门禁的后续事务，并观察异步拒绝以避免未处理的 Promise 异常。由于异步发布可能已经开始执行，不能回滚它的副作用，不能将该回执视为已成功发布。

## 验证与后续
在 `tests/merge-normal-ui-flight.test.mjs` 中补充三项回归：异步发布不能返回成功、异步拒绝不泄漏为未处理异常、同步发布仍保持成功。实际游戏页面 `merge/main.mjs` 尚未接入 Web Locks，启动、游戏动作、计时器、重置必须统一迁移，不能仅接入部分写入者。真实双标签、iPhone Safari、微信 WebView 及线上 PostgreSQL/Edge 均未验收。

本轮不修改 `main`、正式导航、部署白名单或线上数据库；PR #58/#59 保持 Open/Draft。提交后必须检查该 SHA 的全仓库回归、静态安全与部署隔离、完整 Git 历史密钥扫描；未全成功前不得标记工程完成。
