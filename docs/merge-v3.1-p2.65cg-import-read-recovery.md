# 云屿 V3.1 · P2.65cg｜原生文件读取失败后的普通模式恢复闭环（未发布）

## 发行阻塞与验证范围

10 月 30 日的普通模式存档导入回归已覆盖单次 File.text() 失败、取消及 BFCache 撤销，但尚缺少在**同一真实浏览器页面**连续发生读取失败、取消挂起读取、正常经营和重新选择文件的操作闭环。本轮只新增独立 Chromium 端到端回归，不改变运行时、经济、存档格式或故事源文件。

新增 tests/merge-browser-import-recovery-p0.test.mjs，使用实际 Chromium、真实 DOM、原生 File/DataTransfer、Web Locks 和 localStorage；仅替换 OS 文件选择弹窗触发、File.text() 故障行为及用户确认响应。覆盖：

1. File.text() Promise 拒绝后，确认弹窗不出现，导入按钮恢复，原始普通存档及恢复前备份保持原字节。
2. 第二次 File.text() 故意挂起，用户点击取消后必须替换旧 input、解除等待；迟到的 File.text() 成功不得再次弹窗或恢复。
3. 两次异常后，玩家可以正常生产并完成已验证的存档写入；随后新文件选择必须进入明确确认流程，玩家拒绝后不能覆盖新进度。
4. 全程核对剧情模式独立键不变，未发放金币、经验或任何补偿。

## 门禁与边界

本地可进行独立测试文件的 Node 语法检查，但完整仓库不可在当前执行容器通过 DNS 克隆；实际运行和全仓库 Node、security-check.sh/部署隔离、完整历史密钥扫描必须以**新 HEAD** 对应的 GitHub Actions 真实作业为准。若失败，不可声称修复完成。

此测试不代表 OS 文件选择器、iPhone Safari、微信 WebView 的真机结果；Chromium 触控模拟亦非实机。Cloudflare Pages 后台部署状态仍需独立核实。保留 [CF-Pages-Skip]、PR #58/#59 Open/Draft；不合并 main、不发布、不改导航/白名单、不操作线上 Supabase/Edge、不添加作弊后门。11 月 10 日仅根据验证证据建议或拒绝 RC，发布必须用户单独授权。
