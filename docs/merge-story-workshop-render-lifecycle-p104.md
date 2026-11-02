# 云屿首卷 P104｜剧情工作台读取期间的移动端生命周期阻断（未发布）

## 复现与修复
剧情工作台渲染会读取独立的剧情对白存档，计算“首卷下一步”导航及三处建筑的剧情前置条件。旧顺序先按页面可见状态生成 56 个棋盘按钮，再读取剧情存档。如果读取期间浏览器同步触发 `pagehide` 或隐藏事件，内层暂停渲染虽正确禁用控件，外层渲染返回后却可能重新显示旧导航、启用按钮。这属于移动端恢复/离开期间的过期界面状态风险，不能依赖点击时的写入 CAS 作为唯一保护。

现在先读取剧情前置存档，再重新计算暂停状态，之后才构造按钮、重置入口、建设按钮和下一步导航。读取仍为只读；既有写入 Web Locks、原字节 CAS、剧情门槛及经济数值不变。

## 专项验证
`tests/merge-story-workshop-lifecycle-p70.test.mjs` 新增两项实际入口 DOM 故障注入：在剧情存档 `getItem` 中同步派发 `pagehide` / `visibilitychange(hidden)`，要求导航隐藏、56 个棋盘按钮及重置禁用、两模式存档不写入；仅在可见且通过原存档核对后恢复导航。此夹具不是 Safari 或微信 WebView 模拟器。

全仓库 Node、`bash scripts/security-check.sh`、静态部署隔离及完整 Git 历史扫描均须以最终 SHA 对应 GitHub Actions 结果为准，不能借用旧 SHA 的通过记录。

## 剩余阻塞与发行边界
真实 iPhone Safari / 微信 WebView 的 BFCache、原生确认、异常备份下载落盘、多标签并发，以及 Windows 离线首卷四章人工通关仍待验收；`localStorage` 不是跨标签原子事务。继续保持 PR #58/#59 Draft/Open，不改 main、正式入口、部署白名单、线上 Supabase，不发布 Pages/Cloudflare/Edge；所有研发提交保留 `[CF-Pages-Skip]` 前缀。
