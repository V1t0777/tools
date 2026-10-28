# 云屿 V3.1 P2.65af：后台首次打开与 BFCache 前置恢复（未发布）

## 已确认的 P0 可用性缺陷

普通模式页面此前在模块求值结束时无条件调用一次 `runtime.start()`。如果 iPhone Safari/微信 WebView 在后台预加载页面，`document.hidden` 为 true，启动事务即使未写入也会被视为失效；单次启动许可被消耗，用户返回前台仍停留在“已暂停”，只能重新加载。若尚未启动就收到 `pagehide`，生命周期桥接器还会一直维持 BFCache 暂停状态，导致简单的可见性恢复无法安全启动。

## 修复边界

- 只在页面可见且生命周期桥接器允许时执行**一次**启动；初始隐藏时不读取/迁移/创建存档，等待 `visibilitychange` 或 `pageshow`。
- 对 `cold` 且未阻断、未占用事务的页面，允许可见性恢复解除初始隐藏；如已经 `pagehide`，仍必须收到真实 `pageshow` 才能解除暂停。隐藏状态下的 `pageshow` 只能登记等待可见，不能提前写入。
- 启动已经开始或被阻断时不适用冷启动例外；所有实际存档写入继续使用原 Web Locks、原始字节基线和生命周期许可。未添加自动重试或无锁回退。

## 验证

在实际 HTML 入口的 Node DOM 夹具中新增三项：后台首次加载、首次启动前 `pagehide` 必须等待 `pageshow`、隐藏 BFCache 返回后再可见才启动。生命周期桥接器新增两项只读门禁回归。以上仅为模拟浏览器事件，不代表 iPhone Safari、微信 WebView、真实 BFCache 或文件下载落盘验收。

## 剩余风险与发行门禁

- 启动事务一旦已经尝试、在等待 Web Lock 期间发生页面离开，仍保持 fail-closed；不自动重试可能已经部分写入的事务。
- 不支持 Web Locks 的环境继续拒绝写入。跨标签非协作写入及 localStorage 非原子性仍需真实浏览器验证。
- 不修改剧情源文件、main、正式导航、部署白名单、Cloudflare、Supabase 或云同步。保持 PR #58/#59 Draft/Open，不发布；必须核对新 SHA 的三项 Actions 检查与部署隔离。

## CI 兼容补充

首次提交的全仓库测试发现旧版静态约束禁止普通页面重复注册 `window.pageshow` 监听器。现将冷启动通知接入既有 `attachNormalPageLifecycle` 桥接器的同步 `onReadyForStartup` 回调，不再由普通页面额外注册 `pageshow` 或 `visibilitychange` 启动监听器；新增桥接回调回归。失败的既有测试保留，不降低断言。
