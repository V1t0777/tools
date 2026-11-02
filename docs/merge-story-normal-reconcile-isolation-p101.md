# 云屿 P101：普通模式对账读取租约 × 剧情存档隔离（2026-10-28）

本轮在不改经济数值、故事章节、存档结构与正式入口的前提下，安全同步普通经营 P2.65aj 的对账读取生命周期保护，并补充剧情专属组合回归。

- 普通模式接收同源标签页更新后的合法经营存档时，已经完成的剧情对白与独立工作台原始字节不变。
- 普通模式读取存档期间触发 pagehide / 生命周期失效，旧对账结果被阻断；另一标签独立写入的剧情进度仍保留。
- 剧情对白及工作台存在不完整 UTF-16 原始证据时，普通模式对账不尝试解析、修复或覆盖它们。

专项测试：`node --test tests/merge-story-normal-reconcile-isolation-p101.test.mjs tests/merge-normal-reconcile-read-lease.test.mjs`。全仓库 Node、安全/部署隔离与完整历史密钥扫描以新 SHA 的 GitHub Actions 三项检查为准；CI 通过不等于真机通过。

**剩余阻塞：** `localStorage` 跨标签读写非原子事务；真实 iPhone Safari、微信 WebView 的 BFCache/后台恢复、原生确认、异常存档下载落盘与 Windows 离线四章手工通关均待验收。PR #58/#59 继续保持 Draft；禁止合并 main、发布 Pages/Cloudflare/Edge、修改部署白名单、执行线上 Supabase SQL/迁移或引入作弊后门。
