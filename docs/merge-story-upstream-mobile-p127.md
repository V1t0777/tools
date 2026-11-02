# 《云屿百物铺》P127｜普通模式极窄屏修复与剧情入口安全同步（未发布）

## 三方合并证据
- 剧情 Draft PR #59 合并前 HEAD：`37b9eb8be8ce85323592c318ed90d696e1207b36`。
- 普通模式 Draft PR #58 上游 HEAD：`e4861ff726be68557dc1f3b173fc83fb8d1eb675`。
- 共同祖先：`a02a47f28e9692e656fcee29bc0479016fa242a1`；同步前剧情相对上游 ahead 214 / behind 23。
- 逐文件对照：上游 18 条变更路径、剧情分支 223 条变更路径，仅 `merge/style.css` 重叠。上游其余 17 个路径采用上游原始 blob；剧情独有路径保持不变。
- CSS 三方核对：共同祖先至剧情只在文件末尾追加 `.story-entry-link`（含焦点及深色模式）；共同祖先至上游只在 `P2.16` 样式之前增加 `P2.65aw` 和 `P2.65bf` 规则。将上游新增规则原样插入剧情 CSS，保留全部原剧情入口样式。
- 采用双父 merge commit（第一父剧情 HEAD、第二父上游 HEAD），只前向更新剧情开发分支，禁止强推。两个 Draft PR 不改状态。

## 集成测试与边界
- 新增 `tests/merge-story-upstream-mobile-p127.test.mjs`，检查 ≤360px 七列 44px 棋盘局部横向滚动、原生触控接管、剧情入口 44px 及深色模式样式、普通模式导出/重置入口与大屏拖动基础样式共存。
- 上游原有真实 Chromium 320px 横向/纵向手势、跨列点选、文件入口命中、BFCache/多标签测试与剧情 12/12 主线浏览器测试，均由本次新 SHA 的 CI 重新验证；**未通过前不能宣称集成成功**。
- 本轮不修改剧情正文、经济数值、存档协议、main、正式导航、部署白名单、Cloudflare 设置或线上 Supabase；不发布。
- Chromium/CDP 触控模拟不是 iPhone Safari 或微信 WebView 实机；Windows 离线通关、原生确认框、真实下载落盘与连续完整 UI 经济通关仍是发行阻塞。

## 发布硬边界
仅供 Draft PR #59 内部验证。提交前缀保留 `[CF-Pages-Skip]`，提交后核对 GitHub checks 是否出现 Cloudflare 部署；如有异常停止推送。必须通过 Node 全回归、静态安全与部署隔离、完整 Git 历史密钥扫描；不得合并 main、发布网站或擅自将 Draft 转 Ready。
