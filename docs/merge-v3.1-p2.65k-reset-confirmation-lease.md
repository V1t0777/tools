# 《云屿百物铺》V3.1 · P2.65k 重置确认绑定存档与页面生命周期

范围：仅 Draft PR #58 普通模式页面入口、实际页面 DOM 测试及本说明；不改剧情分支源文件、共享 HTML/CSS、main、部署白名单或线上数据。

## P0 风险与修复

此前重置页面先调用 `window.confirm`，随后直接调用 `runtime.reset({confirmed:true})`。若在同步确认弹窗期间另一标签写入较新进度，storage 事件可能让普通页面安全采用新存档，但重置运行时会以**新存档**为基线执行已确认的清空。用户确认的其实是**旧棋盘**。同理，确认期间页面可经历 `pagehide → pageshow`，最终不再处于暂停态，旧确认却可能继续执行。

现在在弹窗前只读核验并记录精确 `runtime.raw` 与页面生命周期 `importEpoch`；确认返回后再次检查页面暂停状态、epoch、存档状态与原始字节，必要时只读协调跨标签更新。任何变化都取消旧确认并要求重新核对。向 `runtime.reset` **显式传入**已确认的 `expectedRaw`，保留事务内部 Web Locks 与原始字节 CAS 保护。异常存档重置仍采用启动时保存的原始字节和原有强制备份机制，不允许在确认后改用另一份异常数据。

## 回归与边界

实际 `merge/index.html` 引用的 `main-locked.mjs` DOM 回归新增三类：确认中跨标签 storage 事件采用新修订；没有 storage 事件但原始存档已变；确认弹窗期间 BFCache 离开并返回。每种情况旧确认均不写入，重新主动确认仍可重置。以本提交的 Node 全仓回归、`bash scripts/security-check.sh` 与完整 Git 历史密钥扫描三项 CI 实际结果为准，不能将旧 SHA 的成功移植到新 SHA。

剩余：浏览器 `confirm`/页面生命周期的真实 iPhone Safari、微信 WebView 行为，真实双标签及下载落盘需人工验收；GitHub CI 不能代替真机。Cloudflare Pages 实际部署记录未独立核实。保持两个 PR Open/Draft，不合并、不部署、不发布。
