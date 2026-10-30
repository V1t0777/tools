# P156｜剧情一次性事件：后台恢复原字节核对（未发布）

## 本轮范围
延续 P155 的真实 Chromium 双标签剧情测试，补充三段**浏览器内实际 localStorage/DOM**验证：

1. 已完成《潮水送来的木箱》只读回看后，模拟 `pagehide/pageshow`，原始存档未变时可以恢复入口，revision 不增加。
2. 模拟页面暂停期间丢失 `StorageEvent`：以**相同 revision、不同有效选择字节**替换剧情原始存档，恢复必须阻断旧页面、关闭对白，不可把它当作“同一日相同固定事件”自动接纳，也不能覆盖新原文。
3. 暂停期间原始剧情键被删除，恢复必须阻断，不得在旧页面上悄悄创建新进度。普通模式哨兵和剧情经济键保持隔离。

## 运行与安全边界
专项：`node --test tests/merge-story-browser-oneoff-tabs-p155.test.mjs`（要求真实 Chrome/Chromium）。全仓库 Node、安全脚本和完整 Git 历史密钥扫描以**该 SHA 的 GitHub Actions 实际结果**为准，不在此文档预先宣称通过。

`pagehide/pageshow` 由测试在真实 Chromium 页面内主动派发，**不是实际 BFCache 导航，也不是 iPhone Safari/微信 WebView 真机验证**；写入模拟由测试注入，不代表已证明 localStorage 跨标签原子性。测试预置第三章有效剧情进度，不替代第一至第四章真实经营通关。

未改生产剧情逻辑、存档协议、经济数值、普通模式、正式入口或部署配置。保持 PR #59 Draft；禁止合并 main、发布 Pages/Cloudflare/Edge、执行线上 Supabase 操作。11月10日只争取可终审 RC，真实设备、离线包和损坏备份文件落盘仍为 P0 阻塞。
