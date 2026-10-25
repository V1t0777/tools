# P2.61c：异常存档状态下禁止旧棋盘交互（未发布）

本轮仅加固普通模式页面的只读交互边界，不改变存档格式、经济规则或 Web Locks 模块。跨标签存档已变更、移除、损坏或写入结果不明时，页面已有的 `saveIssue` 会拒绝后续保存，但原有棋盘仍可选择旧格子、启动拖拽或计算旧整理建议，容易造成玩家误解。

本次在 `touchCell`、`pointerdown` 和“整理提示”入口增加统一的异常状态阻断；仅显示中文提示，不读取、覆盖、重置或修复原始存档。健康状态下的键盘选择、触摸拖拽和整理建议保留原有行为。

专项回归：`tests/merge-blocked-save-interactions.test.mjs` 覆盖三种阻断原因及健康路径；更新旧版 P2.42 VM 夹具显式提供页面已有的 `saveIssue:null`。本次测试仅为 Node VM 页面处理器级模拟，不代表 iPhone Safari、微信 WebView 或真实跨标签验收。

**重要剩余风险：** `merge/main.mjs` 的 `persist()` 仍是同步写入，尚未整体接入统一 Web Locks 事务；这项 UI 加固不提供跨标签原子性。启动迁移、动作、计时器和重置必须完整迁移后才能宣称写入安全。PR 保持 Open/Draft，禁止合并 main、修改部署白名单、发布 Pages/Cloudflare/Edge 或执行线上 Supabase SQL/迁移。
