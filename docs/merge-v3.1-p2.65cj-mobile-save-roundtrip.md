# V3.1 P2.65cj：普通模式窄屏存档下载—拒绝恢复—继续经营闭环（未发布）

日期：2026-10-30（北京时间）。范围：Draft PR #58 离线普通经营模式；不修改剧情源文件、生产经济规则或线上部署。

## 本轮增加的实际浏览器验证

在现有 `tests/merge-browser-mobile-normal-p0.test.mjs` 的 320/375/390/430px 布局、44px 触控尺寸及原生模拟生产触控门禁基础上，补充 320px 窄屏下连续业务流程：

1. 通过 CDP `Input.dispatchTouchEvent` 实际触摸导出按钮，允许 Chromium Blob 下载，读取落盘 `yunyu-normal-save-v3.json`，与当前 localStorage 原始字节逐字比较；验证导出只读且恢复前备份不变。
2. 用真实 DOM 文件输入 `change` 事件提交低一版本普通模式 JSON，模拟系统文件选择器和用户拒绝确认；检查确认确实出现一次，旧档未覆盖现档，导入按钮恢复、恢复前备份及剧情存档哨兵不变。
3. 在同一 320px 页面再次发送原生模拟触控生产事件，确认 Web Locks 写入后的 revision 达到 2、体力守恒、页面无整体横向溢出；已下载文件仍保持此前的快照字节，不会随着后续经营变化。

此测试不是仅检查按钮存在，而是将窄屏触控、实际下载字节、旧档拒绝和后续经营串成同一会话。保持无固定睡眠的业务条件等待，测试失败不降级为 DOM mock 或静态断言。

## 边界与待验收事项

Chromium CDP 移动模拟不等于真实 iPhone Safari 或微信 WebView。系统文件选择弹窗、真实 iOS 分享/下载位置、刘海安全区、后台冻结、真实 BFCache、微信下载限制仍未验收。本轮不声称这些 P0 已清零。

全仓库 Node、`bash scripts/security-check.sh`、静态部署隔离与完整历史密钥扫描必须核对**最终新 SHA** 的真实 GitHub Actions；本文件本身不代表 CI 通过。Cloudflare Pages 后台状态无法独立验证时继续保持风险。

## 发行边界

仅修改普通模式浏览器专项测试与本文档。PR #58/#59 保持 Open/Draft；不写/合并 main、不改正式导航/部署白名单、不发布 Pages/Cloudflare/Edge、不操作线上 Supabase、不制作作弊后门。提交必须带 `[CF-Pages-Skip]`，不强推。

下一步：在 10/31—11/03 移动端收口窗口继续检验后台恢复/文件选择与双标签更新组合边界，准备 iPhone Safari 和微信 WebView 真机清单；不得以 Chromium 模拟代替真机结论。
