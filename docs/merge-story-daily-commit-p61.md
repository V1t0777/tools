# P61 · 今日事件提交与入口一致性护栏（研发分支，未发布）

## 问题
P47–P60 已确保今日事件在手账正常渲染时等待 Web Lock 固定，但 P46 的纯提交判定仍接受未持久化的同日哈希候选；异常存档阻断状态下的旧事件标签页还可能展示未固定的候选卡片。两者虽受现有 UI 写入保护，仍属于入口与最终提交判定不一致。

## 本轮修正
1. `canCommitDailyIncident` 只接受当前日期**已经写入剧情存档的 pin**，并验证当前 core pack 中的**同一对象**；临时哈希候选、跨日、损坏标记、DLC 同名伪对象全部拒绝。主线/人物支线不受日期规则影响。
2. 今日事件标签页只有在 pin 存在、候选仍合法且剧情存档未阻断时才显示可点卡片；异常状态保留明确提示，绝不展示临时事件或自动重抽。
3. 扩充 P46/P47 回归并新增 P61 专项测试，覆盖固定前/后、跨日、伪对象、异常标记和静态 UI 契约。

## 验证及限制
专项命令：`node --test tests/merge-story-daily-boundary-p46.test.mjs tests/merge-story-daily-pin-p47.test.mjs tests/merge-story-daily-commit-p61.test.mjs`；完整回归和 `bash scripts/security-check.sh` 以最终 SHA 的 GitHub Actions 为准。当前执行环境未完整检出仓库，不声称已本地执行全仓库测试。仍需 iPhone Safari/微信 WebView 实机、后台跨日与多标签并发人工验收。

不修改正式导航、部署名单、普通模式、云端数据或发行配置；PR #59/#58 均保持 Draft。Cloudflare 预览分支禁用仅由用户确认，研发提交仍保留 `[CF-Pages-Skip]` 前缀，并逐 SHA 核对部署检查。
