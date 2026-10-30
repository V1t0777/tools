# 《云屿百物铺》P47 · 同日动态事件持久固定（仅开发分支）

## 实际问题
此前每日事件使用 `pack.id + 本地日期` 哈希对**当时已解锁事件列表**取模。玩家当天先看见“小猫”，再推进主线解锁“烤箱”“旅人”后，候选数改变，哈希取模结果可能改变；不同标签也可能展示同一天不同事件。P46 已解决跨午夜旧事件提交，但无法解决这类**同日重抽**。

## 实施
- `merge/story/runtime.mjs`：新增 `pinDailyStoryIncident` / `pinnedDailyStoryIncident` 纯函数。首次有候选事件时，在对应故事包已有的 `choices` 字典写入保留键 `daily-YYYYMMDD`，值为真实事件 ID；原有 schemaVersion=1 与存档键不变。标记只在现有 **Web Lock + 原始字节 CAS + 读回验证** 流程下提交。已有当日标记不会重新选择；非法或已失效的标记返回 `null` 而不是擅自重抽。
- `merge/story/ui.mjs`：剧情页面首次出现可用事件时，即使当前浏览的是主线，也异步固定当天选择；在写入完成前不显示可点击的临时事件。日期跨越锁等待期时拒绝旧日期提交。所有读取与锁内写入仍使用已有 `saveStoryDialogueWithLock`，不增加另一套跨标签锁。
- 每次新日期固定时删除同故事包旧的 `daily-YYYYMMDD` 标记，避免无限累积、触发现有 256 个 choice 条目限制。其他真正的主支线选择原样保留；不同 DLC 故事包互不覆盖。**`daily-YYYYMMDD` 是保留的内部 choice 键，未来内容包不应把它用作章节 ID。**
- 没有新奖励、每日抽奖、体力、经济资源或数据库写入；用户确认重置仍由原有存档重置流程负责。

## 专项测试
`node --test tests/merge-story-daily-pin-p47.test.mjs tests/merge-story-daily-boundary-p46.test.mjs tests/merge-story-runtime.test.mjs`。
覆盖：新增解锁后的同日固定、能证明旧算法确实重抽的反例、隔日更新与清理、损坏标记拒绝重抽、并发旧基线 CAS 拒绝、DLC 分包隔离、UI 固定完成前的可操作门禁。另需运行全仓库 Node 回归、`bash scripts/security-check.sh` 与完整 Git 历史密钥扫描，以最终 SHA 对应 CI 为准。

## 尚未解决
- 固定标记的本地日期来自设备时钟；用户手动改日期、极端时区切换仍可能导致不同日的选择，需后续 UX 与边界测试。
- 存储禁用、写入失败或 Web Locks 不可用时不允许承诺同日固定；旧标签的无锁写入无法被新代码完全约束。
- `choices` 字典复用现有 schema 的保留键，长期 DLC 演进可考虑显式版本化迁移；当前避免为小功能修改整个存档结构。
- 尚未完成 iPhone Safari、微信 WebView、双标签真实浏览器及玩家剧情节奏验收。CI 全绿不等于真机验证或 RC。

## 强制发行边界
仅 PR #59 的 Draft 开发分支，安全合入 PR #58 上游变更；不得修改或合并 main、发布 GitHub Pages/Cloudflare/Edge、改正式导航或部署白名单、运行线上 Supabase SQL/迁移、制作作弊后门。
