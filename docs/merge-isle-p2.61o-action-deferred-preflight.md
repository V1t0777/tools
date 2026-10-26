# P2.61o · 普通模式动作延迟求值与统一入口准备（未发布）

## 本轮范围
普通模式 `merge/main.mjs` 的玩家动作统一在 `commit()` 内完成原始存档只读复核之后，才执行对应引擎动作。涵盖棋盘生产/合成、委托交付、仓库收取/取出、升级/建设、补给使用与兑换。保持原有引擎动作、经济数值、存档格式及同步 CAS 写后回读不变。

此前调用方先计算 `commit(engineAction(state))`，即使 `commit()` 随后发现其他标签页已替换存档，引擎计算也已经发生。本轮改为 `commit(current=>engineAction(current))`；在原始存档缺失、损坏、跨标签变化或页面已经阻断时，不调用引擎动作。旧的结果对象入参仍受支持，以避免破坏既有页面回归及拖拽完成路径。

## 专项验证
`tests/merge-nonboard-action-preflight.test.mjs` 新增：存档被替换不求值、已阻断不求值、正常存档只执行一次且先读取、引擎拒绝不写入，以及主要动作入口静态覆盖。完整回归、静态安全与部署隔离、完整 Git 历史密钥扫描须以**本次最终提交 SHA** 的 GitHub Actions 为准。

## 风险与下一步
本轮**没有**将实际页面切换为异步 Web Locks 事务；同步 `persist()` 仍不能保证跨标签原子写入。拖拽落点的既有引擎计算仍在 `completeDrag()` 中先于 `commit(result)`，但其已有落点前原始字节复核及 CAS；计时器、启动迁移、重置也尚未统一迁入 Web Locks。后续应设计整个页面写入路径一次性切换的兼容门禁，避免部分持锁、部分不持锁。

仍未完成 iPhone Safari、微信 WebView、真实多标签端到端和真实 PostgreSQL/Edge 验收。PR #58 必须保持 Open/Draft，不合并 main、不改正式导航或部署白名单、不发布 Pages/Cloudflare/Edge、不执行线上 Supabase SQL/迁移，不制作美术或作弊后门。
