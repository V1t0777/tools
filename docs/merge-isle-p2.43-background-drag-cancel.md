# 《云屿百物铺》V3 · P2.43 页面进入后台时取消悬空拖拽（未发布）

## 风险与范围
移动浏览器在拖拽物品过程中进入后台（切换应用、锁屏、系统中断）时，可能没有正常送达 pointerup/pointercancel。此前拖拽状态及悬浮图标可能一直保留；重新回到页面后，迟到的事件可能引用后台前的棋盘操作。

## 单一工程增量
- 仅在普通模式页面注册 `visibilitychange` 事件；当 `document.hidden` 且有活动拖拽时，通过已有 `completeDrag(..., true)` 取消手势、移除悬浮图标。
- 设置 `ignoreNextClick` 阻止潜在迟到的合成点击；沿用 P2.42 在下一次真实主按钮 pointerdown 解除抑制的规则。
- 页面仍可见、没有活动拖拽或重复进入后台时不执行操作。
- 不修改存档、经营数值、剧情模式、部署白名单或网络请求；不触发自动保存。

## 专项验证与边界
`tests/merge-storage-event-policy.test.mjs` 通过 Node VM 执行真实拖拽完成函数和 visibilitychange 回调，覆盖进入后台、悬浮图标清理、迟到 pointerup、空闲事件及重复事件；不能替代真实 iPhone Safari/微信 WebView 的生命周期测试。同步 localStorage 跨标签竞争仍未消除；下一轮优先评估 Web Locks 实际保存路径的安全渐进接入。

仅在 Draft PR #58 的独立分支开发，不修改 main、不合并、不部署、不触碰线上 Supabase。必须确认本次 HEAD 对应全仓库回归、静态安全与部署隔离、完整历史密钥扫描全部成功后才能标记完成。
