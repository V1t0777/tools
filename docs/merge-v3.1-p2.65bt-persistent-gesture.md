# P2.65bt｜前台跨标签更新后持久按钮的旧触控保护（未发布）

## 风险与修复

普通模式的重置、导出、仓库升级等持久按钮不会在棋盘重绘时被替换。此前按钮的触控租约只在文件选择、页面离开等情况下失效；若另一同源标签在当前页面**始终可见**时写入并被采纳，旧 pointerdown 的延迟兼容 click 可能作用于新存档。动态按钮有 renderGeneration 防护，但持久按钮没有等效的跨标签失效机制。

在 `merge/main-locked.mjs` 的 `onVerified` 中，只要实际存档原始字节改变，就递增 `persistentGestureGeneration`，使旧触控租约在最终 click 阶段被拒绝。新指针可以重新操作；键盘 `detail===0` 的新激活维持既有语义。没有修改经济、存档结构或部署配置。

## 可复现回归

在真实 Chromium 双标签页面中保持 B 始终前台：先在 B 的重置按钮触发 pointerdown，再由后台 A 使用原生 Web Locks 和真实引擎 `produce` 写入合法新版本；等待 B 通过 storage 事件采纳新进度，随后派发旧 click，必须**不弹重置确认、不改存档或备份**。再次以新 pointerdown/click 触发确认（测试明确拒绝），确保没有永久锁死。对导出按钮重复该流程：旧 click 不应触发锚点下载，新 click 可以请求下载。测试对触控事件时序采用确定性注入，非真实 iPhone/微信手势；跨标签存储、Web Locks、页面代码和引擎仍在 Chromium 执行。

## 发行与验证边界

必须核对本提交 SHA 的全仓库 Node、`bash scripts/security-check.sh`/静态部署隔离及完整 Git 历史密钥扫描；未全部通过不得宣布完成。真实 iPhone Safari/微信 WebView 的文件选择、下载落盘、BFCache 及触控仍需真机验收。Cloudflare 后台是否发生部署不能从 Actions 缺席推断。PR #58/#59 保持 Open/Draft；禁止合并 main、发布、修改正式导航/白名单、执行线上 Supabase SQL/迁移或添加作弊后门。
