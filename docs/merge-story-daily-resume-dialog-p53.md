# P53 · 后台恢复时的安全剧情对白保留（未发布）

## 复现与修复

P52 已支持 iPhone Safari 后台/BFCache 恢复时，重新读取本地剧情存档，并且只接纳其他标签写入的字节完全一致的当日事件固定记录。但恢复入口仍无条件关闭对白：`pageshow` 与 `visibilitychange` 可能接连触发，使主线或人物支线已选的回答被意外丢弃。

本轮将恢复检查结果交给纯函数 `canKeepResumedStoryDialogue`：只有剧情原始快照一致，或者 P52 安全接纳完全一致的每日固定记录，并且没有阻断、没有正在写入、对白确实打开、当前条目是原始 core pack 内仍已解锁/已完成的主线或支线时，才保留对白和当前选择。重复的恢复事件也按同一规则处理。

每日动态事件始终关闭（跨午夜可能已过期）；损坏/冲突/不可用存档、写入中的标签、未解锁章节、伪造的 DLC 同名条目全部关闭。真正的剧情提交仍会在现有 Web Lock 内重新检查经营目标和事件日期，不放宽 CAS 或锁要求。

## 自动化与限制

- 专项：`node --test tests/merge-story-daily-resume-dialog-p53.test.mjs`
- 全仓库：`node --test tests/*.test.mjs`
- 安全门禁：`bash scripts/security-check.sh`
- CI：必须核对最终 SHA 的 Node、静态安全/部署隔离、完整历史密钥扫描全部成功；**尚未以本文件宣称测试通过**。

此变更不写入存档、不改变经济、DLC 数据或普通模式，不修改部署名单，不触及 main 或线上 Supabase。仍需 iPhone Safari/微信 WebView 的真实 BFCache、双标签并发和可访问性验收，自动化检查不等于真机验证。
