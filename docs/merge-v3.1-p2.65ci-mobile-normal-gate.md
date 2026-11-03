# V3.1 P2.65ci：普通模式窄屏触控发行门禁（未发布）

日期：2026-10-30（北京时间）。范围：Draft PR #58 的离线普通经营模式，不涉及剧情源文件、线上服务或发行部署。

## 目标与实现

新增 `tests/merge-browser-mobile-normal-p0.test.mjs`，使用真实 headless Chromium + CDP 的移动设备视口和触控模拟，不使用 DOM mock 冒充真实布局。四个 CSS 视口宽度：320、375、390、430px；设备像素比为 3。

- 逐个检查文档没有横向溢出，56 格棋盘单格宽度不低于约 44 CSS px；320px 时棋盘在自身容器内横向平移，不使整页横向滚动。
- 检查玩法、整理提示、普通模式导入/导出、恢复备份导出、重置、仓库升级、收纳及死局解围等持久按钮可见且高度不低于约 44 CSS px。
- 在 320px 视口使用 CDP 原生触控事件点击实际生产器，验证触控命中、Web Locks 经营写入、revision 增加和体力守恒。
- 测试失败即使其他测试通过，也不得将移动端 P0 视为完成；不增加跳过、固定等待代替业务条件或无锁回退。

## 验证边界与风险

本测试是桌面 Chromium 的移动视口/触控模拟，**不是**真实 iPhone Safari，也不是微信 WebView。它不验证 iOS 文件选择、分享/下载落盘、软键盘、刘海安全区、浏览器后台冻结、真实系统内存压力及真实 BFCache。上述项目仍属于发行前必须完成的真机验收。

原有 Chromium 双标签/Web Locks、BFCache、导入导出及异常恢复专项仍需保持通过。完整 Node 回归、`bash scripts/security-check.sh`、部署隔离和全历史密钥扫描必须以**本轮最终 SHA** 对应的 GitHub Actions 实际结果为准；本文件不宣称 CI 已通过。

## 发行与并行研发边界

仅新增普通模式测试和本说明；不修改 `merge/story/**`、`merge/story.html`、`merge/index.html` 或共享 `merge/style.css`，避免与 PR #59 并发写入。保持两个 PR Open/Draft；不写 main、不更改导航/白名单、不发布 Pages/Cloudflare/Edge、不操作线上 Supabase、不制作作弊后门。提交必须带 `[CF-Pages-Skip]`，Cloudflare 后台部署状态若无法独立核实须继续标为未知。

下一步：若门禁失败，先从真实浏览器布局结果定位具体宽度和元素，再按最小修复原则处理；若门禁通过，继续组合验证文件导入/导出与后台恢复，并安排 Safari/微信真机清单。
