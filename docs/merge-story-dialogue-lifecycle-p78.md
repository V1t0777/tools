# P78 · 剧情对白后台/BFCache 存档保护（未发布）

## 问题与边界
此前剧情工作台已经在 `pagehide` / `visibilitychange` 时暂停操作，但剧情对白页的 `saveStoryDialogueWithLock` 在等待 Web Lock 期间缺少相同的页面生命周期撤销信号。iPhone Safari / 微信 WebView 在后台或 BFCache 恢复时可能迟到执行旧重置、对白提交或每日事件固定。单纯依赖 `storage` 事件无法覆盖页面休眠期间漏收事件。

## 本轮实现
- `merge/story/ui.mjs`：剧情页新增 `pageGone / visibilitySuspended / resumePending`。进入后台或 `pagehide` 立即递增 `storageEpoch`、关闭旧对白并禁用提交/重置/异常备份。所有待执行 Web Lock 回调重新检查 epoch 与页面可见状态；不自动重试任何结果不确定的写入。
- 隐藏状态下的 `pageshow` 不直接恢复写权限；仅在可见并经过原始剧情存档字节复核后恢复。恢复时仍保留已有同日确定性事件固定的严格例外；任意其他冲突均阻断。
- 每日事件自动固定在后台暂停，不从隐藏页写入；所有原生确认、剧情选择、主/支线快捷入口均增加暂停防护。经济规则、存档格式、普通模式、正式导航与部署配置均未修改。
- `tests/merge-story-dialogue-lifecycle-p78.test.mjs`：加载真实剧情 UI 模块，模拟 Web Lock 等待、pagehide、隐藏 pageshow、后台外部覆盖、普通隐藏/可见恢复，断言不会越权写入普通经营或剧情工作台存档。另有静态契约检查。该 DOM 夹具不是 iOS 真机。

## 发行阻塞与验收
需在 iPhone Safari、微信 WebView、Windows 实机分别验证：剧情选择确认过程中切后台、锁等待后返回、页面前进后退（BFCache）、双标签同时重置/完成对白、异常存档备份在“文件”应用实际落盘。若存在结果不确定的写入，必须要求玩家重新打开并核对；不得自动重试。
保留 PR #59 Draft；所有提交使用 `[CF-Pages-Skip]`。不得合并 main、发布 Pages/Cloudflare/Edge、修改正式部署白名单或操作线上 Supabase。CI 全绿也不能替代实机。
