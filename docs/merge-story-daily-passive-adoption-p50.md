# 《云屿百物铺》P50：被动标签安全接纳同日固定事件（未发布）

## 真实缺口
P49 只允许已经发起写入的标签在存档锁返回后接纳另一个标签写入的完全相同事件。另一标签如果只在主线页阅读、尚未开始写入，却收到相同事件的 `storage` 通知，原实现会一律设置 `WRITE_CONFLICT`，迫使重新打开页面。

## 增量
- `merge/story/daily-pin-reconcile.mjs` 新增只读 `adoptConcurrentDailyPinStorageEvent`：必须是当前 `localStorage` 的剧情对白 key；`oldValue` 必须等于本标签持有的原始字节，`newValue` 必须等于**再次读取到**的真实存档字节，且差异必须精确等于从旧存档产生的唯一同日事件 pin。格式变化、任意章节推进、选择修改、存档损坏、跨午夜、`clear()`、其他存储区域及 DLC 更改一律拒绝。
- `merge/story/ui.mjs` 只在当前标签**没有保存操作且未被阻断**时接纳，失效旧交互与对话框并刷新视图；正在写入的标签仍走 P49 的锁内结果校验，所有非匹配存档变更仍然锁定。
- 新增 `tests/merge-story-daily-passive-adoption-p50.test.mjs` 六组专项测试，包含竞争读回、存储故障、旧基线、跨日及 UI 安全约束。没有更改存档版本、普通经营资源、每日事件算法或部署行为。

## 验证与发行边界
必须以此提交的 GitHub Actions 游戏与安全回归、静态安全与部署隔离、完整 Git 历史密钥扫描三项最终结果为准。此变更只是对协作标签的窄范围只读接纳，**不解决没有 Web Locks 时任意并发写入的原子性**。仍需真实 Safari / 微信 WebView / 双标签测试，不能以 CI 代替真机。PR #58/#59 保持 Open/Draft；不得修改 main、发布服务、改部署白名单、操作线上 Supabase、制作作弊后门。
