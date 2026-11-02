# 云屿剧情 P98｜普通存档原生导入与双剧情存档隔离（未发布）

- 日期：2026-10-28（北京时间）。仅 Draft PR #59；先核对共同祖先与三个上游 Blob SHA 后，前向同步普通模式 PR #58 的 P2.65ag 导入预检后确认许可复核，保留双父历史，不覆盖剧情侧代码。
- 本轮新增真实模块组合测试：普通模式通过原生文件导入预检、确认及独占 Web Lock 恢复后，剧情对白和剧情工作台原始存档不变，且对白仍可继续完成并持久化；误选剧情存档文件时拒绝导入，异常 UTF-16 剧情证据不被修复或覆盖；异步文件读取期间另一标签更换普通存档并完成剧情对白时，普通导入拒绝旧基线、保留另一标签已保存的剧情进度。
- 专项：`node --test tests/merge-story-normal-import-isolation-p98.test.mjs`。全量：`node --test tests/*.test.mjs`，静态：`bash scripts/security-check.sh`，全历史密钥扫描以最终 SHA 的 GitHub Actions 为准；未完成检查不能宣称通过。
- 风险：localStorage 非跨标签原子事务，Web Lock 仅协调同源协作标签；模拟 File.text() 和存储钩子不等于 iPhone Safari/微信 WebView 真正的文件选择、下载落盘、BFCache 与多标签实测。
- 发行限制：保持 PR #58/#59 Open/Draft；不改 main、正式导航、部署白名单或生产数据，不发布 Pages/Cloudflare/Edge；提交使用 [CF-Pages-Skip]，新 SHA 必须核查是否意外触发 Cloudflare 部署。11 月 10 日仅争取 RC 终审，仍须另行取得发布许可。
