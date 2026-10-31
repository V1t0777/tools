# 云屿 V3.1 · P2.65cf｜原生导入选择器租约回归时序收口（未发布）

## 问题与证据

2026-10-30 的 PR #58 `586977253aa2355e784515b3cf530609495d72d3` 首次 Security checks 中，既有 Chromium 组合测试 `tests/merge-browser-real.test.mjs:393` 的“native chooser lease must be active”断言失败；同一 SHA 重跑后 1228/1228 通过。这是需要收口的测试时序风险，不能把重跑成功当作原失败不存在。

原测试在“其他标签导入被拒绝后恢复一次生产”时，仅轮询本地存档 revision +1，随即点击原生导入按钮。正式运行时会先在 Web Locks 事务内写入并发布已核验的存档，再结束 UI flight 并由调用方展示“获得 …”操作成功提示。因此 revision 变化**可能早于** `runtime.busy` 解除，导入按钮的安全保护会拒绝忙碌时打开文件选择器。此机制本身应保留，不应为测试绕开保护。

## 本轮修订

- 在恢复生产**之前**安装一次性 `MutationObserver`，只记录真实页面“获得 …”成功提示已出现；该提示由 `await runtime.action()` 完成后的正式操作回调产生。
- 同时检查普通模式已保存状态、导入按钮未禁用、取消导入按钮已隐藏，再进入原生 chooser 租约测试。保留原有 `chooserLease === true`、重置不得确认、导出不得下载、存档与备份原字节不变的全部强断言。
- 不通过固定延时、重试失败点击、放宽断言、跳过测试或改变游戏运行时来消除偶发失败。若仍失败，原有 `waitWithSnapshot` 会记录有限的状态信息而不输出存档内容。

修改仅限 `tests/merge-browser-real.test.mjs` 和本文档；没有修改经济规则、页面运行时、存档格式、故事源文件、云端代码、导航或部署。

## 验证及剩余风险

必须以**新提交 SHA** 对应的全仓库 Node、`bash scripts/security-check.sh`/静态部署隔离、完整 Git 历史密钥扫描三项 Actions 成功作为最终门禁；单次通过不证明所有浏览器时序均已穷尽。真实 iPhone Safari、微信 WebView 的文件选择、后台恢复与下载落盘仍未实测，Cloudflare Pages 后台部署状态仍需独立核验。

PR #58/#59 继续 Open/Draft；提交使用 `[CF-Pages-Skip]`；不合并/写 main、不发布 Pages/Cloudflare/Edge、不修改导航/白名单、不执行线上 Supabase SQL/迁移/数据、不制作作弊后门。11 月 10 日仅根据证据建议或拒绝 RC，发布需用户单独明确授权。
