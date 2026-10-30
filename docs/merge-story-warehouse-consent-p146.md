# P146｜剧情仓库扩容确认与页面恢复安全回归（未发布）

## 背景
P145 已接通剧情模式真实仓库付费扩容，并在可能动用下一处剧情建筑预算时要求用户确认。手机系统原生确认框、BFCache 页面冻结及其他标签页同时改写存档，可能使确认前的金币快照失效。本轮仅补齐相关回归，不更改金币、等级、仓库容量、存档格式或普通模式。

## 本轮新增自动化场景
1. **确认付款的正向闭环**：已有 170 金币、符合扩容条件，用户同意动用建设储备后，实际扩容 4→6 格、扣除 50 金币、revision 0→1；只写一次剧情工作台，不碰普通模式及剧情对白存档。
2. **原生确认期间 pagehide/BFCache**：确认框回调触发页面离开，原点击即使获得确认也不得扣费或扩容；按钮保持禁用，必须等待后续可信页面恢复检查。
3. **同 revision 异内容的并发存档**：确认框期间另一个标签页将金币从 170 改为 165，revision 仍为 0；原页面不得依据过期快照扣费，必须保留对端原始存档并阻断旧操作。

专项测试：`tests/merge-story-warehouse-upgrade-p145.test.mjs`（新增 P146 三项）。
验证入口：`node --test tests/merge-story-warehouse-upgrade-p145.test.mjs`；全仓库 Node、静态安全/部署隔离、完整 Git 历史密钥扫描以最终新 SHA 的 GitHub Actions 三门禁为准。

## 未解决风险与发行边界
- 以上是 Node 事件型 DOM 故障注入，不等于 iPhone Safari、微信 WebView 的原生确认框/BFCache 实机验收。
- localStorage 的跨标签先读后写不是硬件级原子事务；仍需实机检查真实存储事件、Web Locks 支持和异常断电。
- 普通模式 Chromium 触控测试偶发超时、损坏存档下载是否落盘、Windows 离线环境仍是发布前检查项。
- PR #59 保持 Draft/Open；不合并 main、不部署 Pages/Cloudflare/Edge、不执行线上 Supabase SQL、不修改正式导航或部署白名单。所有研发提交保留 `[CF-Pages-Skip]` 前缀；CI 通过不代表发布许可。
