# P2.65cm｜320px 双标签 BFCache / 存档恢复组合门禁

日期：2026-10-30。仅对离线普通经营模式新增 Chromium 端到端验证，不更改正式游戏运行时或经济。

## 连续验证
A 在 320px 移动模拟下打开文件选择器后导航离开；B 是独立同源真实 Chromium 标签，经过正式经营 UI 和 Web Locks 执行一次生产，从 revision 3 写入 4。A 必须真实 BFCache 返回（pageshow.persisted=true），显示 B 的体力及新存档，撤销旧文件选择授权。随后向旧 input 注入迟到 change，确认不弹恢复确认、不覆盖 B 的原始字节。A 再以 CDP 原生触控生产至 revision 5，并真实下载 JSON，逐字节与最新存档一致。全程核对剧情存档哨兵、恢复前备份和 320px 全页横向溢出。

## 未完成与限制
本测试的 OS 文件选择器由测试替换；它不是 iPhone Safari/微信 WebView 实机测试。需检查最终新 SHA 对应全仓库 Node、security-check.sh/部署隔离、全历史密钥扫描三项；不能借用旧 SHA。Cloudflare 后台实际部署仍需独立核实。PR #58/#59 保持 Open/Draft，禁止 main 合并、Pages/Cloudflare/Edge 发布、正式导航/白名单和线上 Supabase 操作。真实 iPhone 文件导入导出、后台恢复与剧情首卷集成仍阻塞 RC。
