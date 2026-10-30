# 云屿 V3.1 · P2.65ch｜导入异常与本地下载互锁（未发布）

## 发行阻塞与工程增量
2026-10-30 17 时轮次：上一轮验证了原生文件读取失败、挂起取消、恢复经营和再次拒绝导入；但缺少同一真实 Chromium 页面中“未完成导入禁止导出”及“异常恢复后可实际下载原始存档”的组合证据。

本轮仅扩充 `tests/merge-browser-import-recovery-p0.test.mjs`，不更改正式运行时、经济、存档格式、部署或剧情源文件。

1. 原生 `File.text()` 挂起时点击持久化“导出原始存档”按钮，验证没有调用任何 Blob 锚点下载，并展示“正在选择或核验导入文件”安全提示。只在此处拦截锚点，避免触发不应发生的下载。
2. 取消挂起读取、撤销迟到结果并完成一次真实经营生产后，使用 Chromium `Browser.setDownloadBehavior` 允许本机下载；实际点击页面导出按钮，等待 `yunyu-normal-save-v3.json` 文件完成，并将下载文件的 UTF-8 内容与当前 localStorage 原始存档逐字节等价比较。
3. 核对导出前后普通存档与恢复前备份没有发生写入；原有后续“重新选择有效文件、明确拒绝恢复、剧情存档隔离”测试保留。

## 验证边界
这是 Chromium 中的真实 Blob 文件落盘检查，仍不能证明 iPhone Safari 或微信 WebView 下载成功。自动化测试不代替真人 OS 文件选择弹窗，也不证明用户能在 iOS 文件 App 找到文件。安全门禁必须以**本轮新 HEAD** 对应的全仓库 Node、`bash scripts/security-check.sh` / 部署隔离、完整历史密钥扫描实际 CI 为准，失败则保持未验证。Cloudflare Pages 后台状态仍需独立核实。

保持 PR #58/#59 Open/Draft；提交带 `[CF-Pages-Skip]`；不写 main、不发布、不修改正式导航/白名单、不操作线上 Supabase/Edge、不制作作弊后门。11 月 10 日候选版需真实 iPhone Safari、微信 WebView 和剧情接口集成证据后再决定是否建议 RC，发布需用户单独授权。
