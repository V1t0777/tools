# 《云屿百物铺》V3 · P2.61a 移动端拖拽延迟点击防重入（未发布）

## 问题
普通模式 `merge/main.mjs` 在完成拖拽合成后设置 `ignoreNextClick`，但原先使用零延迟定时器清除。移动浏览器可能在后续任务才分发合成触发的 click；若定时器先执行，旧 click 会被误当作新点击，导致选中旧棋盘位置，影响下一次操作。此风险在未来异步写入锁接入时尤其需要先消除。

## 本轮单点修复
删除拖拽成功后的零延迟清除，仅保留既有两种释放方式：合成后随之到达的非键盘 click 被消费；或下一次真实 primary pointerdown 清除旧标志。键盘激活（`event.detail === 0`）仍可操作。页面隐藏、跨标签冲突、重置时原有拖拽取消保护不变。未改存档格式、经济、导航、部署或 Web Locks 事务模块。

## 专项验证与边界
新增 `tests/merge-delayed-drag-click-guard.test.mjs`，通过 VM 执行真实页面事件处理器，覆盖延迟 click 仅消费一次、未收到 click 时下一次 pointerdown 恢复操作、键盘 click 不被吞掉；断言不会注册零延迟清除计时器。全仓库及安全检查以本次提交 SHA 的 GitHub Actions 三项结果为准。

这是普通模式页面迁入 P2.45–P2.60 异步 Web Locks 事务前的移动交互安全准备，**并未完成页面写入锁接线**。真实 iPhone Safari、微信 WebView、跨标签和 BFCache 仍待实机验收；不能以 Node VM 模拟冒充实机验证。

继续保持 PR #58 和相关研发 PR Open/Draft；禁止合并 main、发布 Pages/Cloudflare/Edge、执行线上 Supabase SQL/迁移、调整正式导航或部署白名单、制作美术或作弊后门。
