# P70 · 剧情工作台移动端后台/BFCache 恢复保护（2026-10-27，未发布）

## P0 问题

剧情工作台先前只在 `pageshow` / 可见 `visibilitychange` 时只读核对存档，未在 `pagehide` 或隐藏态主动暂停交互。Safari/微信 WebView 的 BFCache 可能在页面仍隐藏时触发 `pageshow`；同时排队的旧按钮或等待 Web Lock 的重置可能在恢复之前继续执行。普通模式 PR #58 的 P2.65d–e 已修复相似生命周期风险，本轮在剧情独立工作台补上同等级保护。

## 本轮关联改进

- **安全合并上游**：先比对 9 个受影响路径在共同祖先和剧情 HEAD 的 blob SHA，确认均未被剧情分支改动后，以双父、非强推提交合入 #58 的 P2.65c–e（下载资源限制、隐藏暂停、隐藏 BFCache 恢复）。
- **剧情页面挂起**：`pagehide`、隐藏态取消选中、递增页面 epoch、禁用经营/重置/异常导出按钮；即使直接派发旧 DOM click 也不会执行写入。等待中的工作台 Web Lock 与重置操作必须再次检查 epoch 和可见性。
- **安全恢复**：隐藏态 `pageshow` 只登记待恢复，不能解锁；必须随后可见并只读比较**原始存档字节**。仅 `visibilitychange`、没有对应 `pageshow`，不得解除先前 `pagehide` 的暂停。普通隐藏/可见切换也须核对存档；发现变化保持受保护状态，不自动重试或覆盖。
- **专项故障注入**：`tests/merge-story-workshop-lifecycle-p70.test.mjs` 加载实际工作台模块，覆盖隐藏 BFCache、缺少 pageshow、隐藏期间跨标签覆盖、普通后台切换、等待 Web Lock 时页面退出。

## 验证及发行阻塞

此轮修改剧情工作台源文件和专项 Node DOM 故障注入测试；不更改资源经济、剧情奖励、普通模式存档、正式导航、部署白名单或生产数据。必须以**新 SHA** 的 GitHub Actions Node 全量、静态安全/部署隔离、全历史密钥扫描为准。自动化仅模拟浏览器事件，**不代表**真实 iPhone Safari、微信 WebView、BFCache、下载落盘、多标签原子事务已通过。真实设备验收仍是发行阻塞项。

PR #58/#59 均保持 Draft；不合并 main、不发布 Pages/Cloudflare/Edge、不执行线上 Supabase SQL/迁移、不制作作弊后门。