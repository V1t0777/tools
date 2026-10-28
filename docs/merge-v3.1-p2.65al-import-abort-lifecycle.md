# V3.1 P2.65al｜后台导入取消异常的生命周期失效保护（未发布）

## 发现的 P0 风险

普通模式原生文件读取期间，`pagehide` 与 `visibilitychange` 监听器直接调用 `activeImportRead.abort()`。在部分损坏或非标准的 WebView AbortController 实现中，`abort()` 可能抛错或返回却没有将 `signal.aborted` 置为 true。原有代码在抛错时会提前退出，跳过 `importEpoch` 递增和文件选择许可撤销；同时阻止测试夹具继续派发后续生命周期监听器。旧文件结果因此可能保留错误的授权代次。

## 本轮修复

1. 提取 `abortImportOnLifecycleExit()`：验证实际 `signal.aborted===true`，抛错或无效取消时将普通模式 UI 标记为不确定并暂停写入，不宣称取消成功。
2. `pagehide` 使用 `finally` 无条件撤销导入代次、选择器和隐藏文件队列；`visibilitychange` 的隐藏分支同样确保代次失效和原有一次原生选择器隐藏宽限。
3. 仅修改普通模式独立入口，不改剧情源文件、经济、存档格式、云端和部署。保留原有 Web Locks、恢复前备份和最终写入许可检查。

## 回归证据与限制

`tests/merge-locked-page-dom.test.mjs` 新增两项真实普通页面入口 DOM 故障注入：模拟 AbortController 抛错的 BFCache 离开，以及 abort 无效的后台隐藏；在原生文件读取延迟返回后验证零普通存档写入、零恢复前备份、剧情存档未改变及 UI 阻断。

测试只是 Node DOM 夹具，不等同于真实 Safari/微信 WebView。仍须真实双标签、BFCache、文件落盘和移动端验收。CI 以当前新 HEAD 对应的 Actions 日志为准。Draft PR 保持开放且不发布，禁止修改 main、正式导航/白名单、Cloudflare/Pages/Edge 或线上 Supabase。
