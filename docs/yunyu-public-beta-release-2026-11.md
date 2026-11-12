# 云屿百物铺 · 公开试玩版发布边界（2026-11-12）

已获用户授权发布，但本次**仅发布离线经营＋剧情试玩版**，并非四账号云存档交付。

- 来源：研发 Draft PR #58，精确已验证 SHA `f16c5b6a20a3bb19b9b904c10e3b6c0b729fbbda`，原全量 CI 1810/1810。
- 路由：`https://v1t0777.github.io/tools/merge/`，通过工具箱小游戏页面进入。
- 发布文件：`scripts/merge-public-files.txt` 固定列出 78 个离线资源，只允许 `merge/` 及 `merge/story/` 下受审查的 HTML/CSS/MJS。
- 禁止：GitHub Pages 发送 Supabase 登录、白名单、云客户端、未应用 SQL、Edge Functions、凭据或本地私人存档。
- 存档：每台设备/每个浏览器独立，本地存储；清除网站数据可能造成不可恢复损失，建议使用存档导出功能。
- 发布门槛：独立发行 PR 通过 security-check、完整 Node/Chromium 回归、GitHub Pages 正式部署工作流；真实地址 HTTP 状态和入口正常后才报告已发布。
- 未发布：四账号云同步、跨设备数据迁移、正式云端存档；继续保留 PR #58/#59 Draft，直到真实数据库/Edge/真机安全验收完成。
