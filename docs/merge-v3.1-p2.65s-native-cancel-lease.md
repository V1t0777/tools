# P2.65s｜原生文件选择取消与迟到 Web Lock 恢复保护（未发布）

日期：2026-10-27；仅普通经营模式 Draft PR #58。发行候选目标为 2026-11-10，绝不自行发布。

## 问题与修复

此前原生文件选择器的 cancel 事件只清除选择器句柄。部分移动浏览器可能在 change 之后迟到发出 cancel，此时 File.text() 仍在等待，或用户确认后的恢复事务正等待独占 Web Lock；清空句柄并不会撤销已发出的恢复授权。

- cancel 现在撤销当前 AbortController，并推进文件选择授权 epoch。等待中的文件读取即时释放 UI；迟到 File.text() 结果不可触发确认或写入。
- 取消发生在确认之后、Web Lock 到达之前时，锁内 canCommit 再次检查 AbortSignal，拒绝备份槽预留及存档写入；明确未写入的拒绝保持可重试。
- 若浏览器不提供 AbortController，或构造器异常，则在开始导入前拒绝，不以无法取消的导入事务冒险。原有手动只读导出、异常备份导出与普通经营不受影响。
- UI 区分取消和未发生写入的恢复拒绝。原始普通模式与剧情存档不共享。

## 回归证据与范围

新增真实 HTML 入口 DOM 模拟回归：change 后挂起读取再 cancel、确认后等待 Web Lock 再 cancel、缺少 AbortController 的安全拒绝及恢复。原有 BFCache/跨标签、重置和下载回归必须同时通过。

本轮不触碰 story 源文件、main、部署白名单、云端 Supabase/Edge，也不创建后门。提交必须以 [CF-Pages-Skip] 开头，PR 保持 Draft/Open。

## 剩余风险

浏览器原生 File.text() 不保证物理中止，依赖 AbortSignal 隔离迟到结果；已在锁内完成的同步写入不可被之后的 cancel 撤销。真实 iPhone Safari、微信 WebView、双标签、文件下载落盘与 Cloudflare 实际部署后台仍需独立验收。自动化 DOM/Node 回归不能冒充实机。