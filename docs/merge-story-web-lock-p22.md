# P22 · 剧情工作台 Web Locks 可选互斥写入（Draft，禁止发布）

## 实际增量
- `merge/story/write-lock.mjs` 新增受限于两个剧情存档键的独占 Web Locks 包装器。Web Locks 支持时同一来源、同一存档键的**参与者**顺序执行；回调内部继续使用现有 `expectedRaw` 原文比较与写前二次读取。
- `merge/story/workshop.mjs` 仅将**正常经营操作**迁移到异步独占锁，新增 `saving` 防重入，并在等待期间禁用棋盘、订单、建筑、仓库及重置按钮。等待期间收到跨标签失效事件则拒绝旧操作。
- 对未提供 `navigator.locks` 的浏览器，仍使用既有同步 CAS 写入，明确标记 `cas-fallback`；**这不提供原子性保证**。API 存在但请求失败时拒绝操作，不能悄悄降级重试。
- 不改变剧情对白保存路径，也未将工作台**确认重置**纳入 Web Locks；这两项留待后续谨慎集成。无新增依赖、存档键、后端访问、资源奖励或部署变化。

## 确定性验证
`tests/merge-story-web-lock-p22.test.mjs` 使用可控的 Web Locks 队列模拟两个标签同时操作相同初始快照：第一个成功，第二个因为原文变化而失败；另外覆盖 API 不可用回退、拒绝/抛错 fail-closed、普通模式键拒绝及 UI 防重入。旧 P16 UI 静态契约同步更新。完整仓库 CI 仍需验证。

## 明确保留风险
- Web Locks 仅在浏览器实现支持、同源并且**所有写入者都采用同一锁名**时协调；老页面、其他代码、工作台重置和对白保存仍可与其竞争。不能称为真正全局原子事务。
- iPhone Safari / 微信 WebView 的 Web Locks 可用性、后台挂起与 BFCache 恢复、锁等待/拒绝、双标签交错写入及真实触控行为尚未真机验证。无 Web Locks 的降级路径仅为 best-effort CAS。
- 后续应将重置及对白保存纳入同一写入协议并做确定性测试；不可为了兼容性关闭存档校验。

## 发行边界
保持 PR #59 Draft；不合并/修改 main，不发布 Pages/Cloudflare/Edge，不修改正式导航/部署白名单，不执行线上 Supabase SQL/迁移，不接触生产数据，不加入作弊后门。
