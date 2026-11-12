# 云屿 V3.1 P2.65ac：BFCache/跨标签事件重入封锁（未发布）

## 本轮发现的确定性风险

普通经营页面的生命周期桥接器在 `pageshow`、`visibilitychange`、`focus` 进行同步存档复核时，可能被嵌套的 `pagehide` 或隐藏事件打断。旧实现仅检查 `inspect().ok`，没有验证检查期间是否又发生页面离开；因此新 `pagehide` 之后仍可能错误清除 `pageGone`，把 BFCache 页面当成已恢复。旧桥接器还允许 `pagehide` 后、真正 `pageshow` 前的 `storage` 事件触发普通模式 UI 读档发布。

## 修复与边界

- 为每次 `pagehide`、隐藏可见性事件递增生命周期代次；存档预检、复核、回调和解除暂停必须仍处于同一代次。期间再次离开时以 `LIFECYCLE_INVALIDATED` 保守阻断，不把旧结果视为安全。
- `pageGone` 时普通 `storage` / `focus` 事件不进行读档发布；仅真实 BFCache `pageshow` 或待恢复的可见性事件可以触发核验。
- 复核期间重入页面隐藏时不得恢复按钮，也不得执行文件选择器的 `onFocus` 恢复逻辑；保留现有普通模式 Web Locks、导入导出及剧情存档隔离，不改任何存档字节。
- 仅修改独立 Draft PR #58 的生命周期模块、Node 专项回归与本说明；未改剧情源文件、main、导航、部署、线上数据库或云端功能。

## 可重复证据

新增 `tests/merge-normal-lifecycle-reentrant.test.mjs` 四个用例：BFCache 复核中再次 pagehide、可见性恢复中再次隐藏、pagehide 期间 storage 事件、focus 复核中再次 pagehide。修复前的 BFCache 反例可复现：两次 pagehide 后 `bridge.suspended === false`，修复后保持暂停并阻断。最终全仓库 Node、安全/部署隔离及全历史密钥扫描以本次提交 SHA 对应的 Actions 结果为准，不用旧 SHA 替代。

## 剩余发行阻塞

同步模拟不等于真实 Safari/微信 WebView。仍须双标签、BFCache、原生文件选择、下载落盘、重置/恢复组合的真机回归；需要验证与 Draft PR #59 的最终集成。Cloudflare 后台实际部署记录未获独立验证，不能宣称绝对无预览部署。11 月 10 日仅根据证据建议或拒绝 RC，未经单独授权绝不发布。
