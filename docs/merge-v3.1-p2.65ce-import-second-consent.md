# 云屿 V3.1 · P2.65ce｜普通模式导入二次确认竞态回归（未发布）

## 本轮关联风险

普通模式导入较低 revision 的存档时，先显示覆盖当前进度的确认，再显示独立的降级确认。第二次确认的时间窗口同样可能遇到另一标签更新本地存档、iPhone 页面离开或 BFCache 恢复、用户取消导入。任何一次旧确认均不能当作针对新存档的授权。

新增 `tests/merge-normal-import-consent-races-p0.test.mjs`，使用正式 `performNormalSaveImport` 及结构合法的 V3 存档，覆盖四个独立的故障注入场景：

1. 第二次确认期间其他标签写入更高 revision 的原始存档：返回 `SAVE_CHANGED`，不调用锁事务恢复，保留新字节。
2. 第二次确认期间页面生命周期 epoch 变化：返回 `PAGE_SUSPENDED`，不执行恢复。
3. 第二次确认期间取消信号触发：返回 `PAGE_SUSPENDED`，不执行恢复。
4. 原生 `File.text()` 异步拒绝：返回 `FILE_READ_FAILED`，不打开任意确认、不执行恢复。

每个场景均断言普通模式原始字节或其他标签的新字节不被覆盖、剧情命名空间保持原样。此轮只增加测试与文档，不修改正式运行时、存档格式、经济规则或故事源文件。

## 证据与局限

专项命令：`node --test tests/merge-normal-import-consent-races-p0.test.mjs`。全仓库 Node、`bash scripts/security-check.sh`、静态部署隔离及完整历史密钥扫描须以**最终提交 SHA** 对应的 GitHub Actions 日志为准。自动化模拟同步确认与异步 File 读取，不等同于 iPhone Safari 或微信 WebView 的原生文件选择器、下载落盘、后台恢复实测。

仍需验证双标签真实浏览器文件导入/导出组合、移动端异常文件读取后重新经营、剧情首卷接口契约和实机下载。Cloudflare Pages 后台真实部署状态未获独立核实。

## 发行硬边界

PR #58 与 #59 必须保持 Open/Draft；提交保留 `[CF-Pages-Skip]`；不合并或写入 main，不发布 GitHub Pages、Cloudflare Pages、Edge，不修改正式导航/白名单，不操作线上 Supabase SQL/迁移/数据，不增加作弊后门。11 月 10 日仅根据完整验证证据建议或拒绝 RC，发布需用户额外授权。
