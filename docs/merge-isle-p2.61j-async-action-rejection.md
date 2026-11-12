# P2.61j：普通模式异步动作误用的拒绝处理（未发布）

## 背景与范围

普通模式 Web Locks 游戏动作事务只接受同步、无副作用的引擎动作。P2.61i 已增加输入状态不可变校验，但当误传的异步动作返回被拒绝的 Promise 时，原实现虽然返回 `ASYNC_ACTION_NOT_ALLOWED`，却没有观察该 Promise 的拒绝；稍后可能产生 `unhandledrejection`，导致页面或测试运行器出现额外异常。

## 本轮变更

- `merge/normal-action-transaction.mjs`：检测到 thenable 后仅附加拒绝处理，仍立即返回 `ASYNC_ACTION_NOT_ALLOWED`，不等待、重试或发布异步结果。
- `tests/merge-normal-action-transaction.test.mjs`：覆盖立即拒绝与事务返回后延迟拒绝两种误用；均要求原始存档不变、零写入、无状态发布。
- 保留原有版本号、基线纯净性、Web Locks、CAS 与写后回读契约；没有修改普通模式页面或存档格式。

## 验证与边界

以本提交对应的 GitHub Actions 全仓库回归、静态安全与部署隔离、完整 Git 历史密钥扫描最终状态为准。Node 模拟不等于真实浏览器或跨标签端到端验收。

该改动只防止误用 Promise 产生未处理拒绝，**不允许异步游戏动作**；若误用的异步代码自行修改外部存储，客户端无法保证撤销。现有 `merge/main.mjs` 仍使用同步 `persist()`，启动、计时器、游戏动作、重置尚未整体切换到同一 Web Locks 边界，跨标签原子性仍未解决。

## 发行限制

PR #58 及相关研发 PR 必须保持 Open/Draft；不得合并 `main`、修改正式导航或部署白名单、发布 Pages/Cloudflare/Edge、运行线上 Supabase SQL/迁移，也不制作美术或实现作弊后门。
