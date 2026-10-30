# 《云屿百物铺》P41 · 花园/港湾章节选择的后续反馈（仅开发分支）

## 问题
已有 P31/P35 将玩家早期选择连接至随机每日事件，但未触发或暂时不遇到该事件的玩家，在主线推进时仍可能看不到决策后果。剧情体验需要**确定性章节反馈**，不应依赖每日事件轮换抽到对应 ID。

## 小范围实现
- `merge/story/mainline-choice-context.mjs`：只为首卷《潮声初起》的**同一对象引用**主线节点提供可选对白，读取 `validateStoryProgress` 通过、且已正式完成的早期选择。DLC 即使复用 `tea-table` / `harbor-light` 名称也不会继承对白。
- 《两个人的下午茶》对「没有开花的花圃」保留旧种子/尝试新花分别回应。不预设种子萌发或揭示岛屿世界的后续真相。
- 《海雾里的灯》对「第一次独立修理」选择示范/放手尝试提供不同的学徒反馈。两分支均坚持岚叔复核与港口安全，不使一条选择变成错误结局。
- `merge/story/ui.mjs` 在主线对白渲染时**只读追加**回声；使用现有 `textContent` 生成 DOM，**不改**章节前置条件、存档字段、经济系统、建筑需求、每日事件选取或奖励。
- `tests/merge-story-mainline-choice-p41.test.mjs`：两组差异、缺失/伪造未完成选择、DLC 同名对象隔离、读操作不变性及 UI 安全合同。

## 上游与验证
同步 PR #58 的 P2.57（`0728581`）新增普通模式四种持锁事务协调组合测试与文档。本同步对既有剧情/普通运行时文件无覆盖。
专项：`node --test tests/merge-story-mainline-choice-p41.test.mjs tests/merge-normal-write-coordination.test.mjs`
门禁：`node --test tests/*.test.mjs scripts/*.test.cjs`，`bash scripts/security-check.sh`，完整 Git 历史密钥扫描。最终以 SHA 对应的 CI 真实状态为准。

## 禁止发行与风险
本功能仅增加首卷有限的主线对白分支，不等于动态事件系统及支线质量全部完成。
普通模式最新持锁事务**仍未统一接入** `merge/main.mjs`，不具有完整旧客户端跨标签原子保证。iPhone Safari、微信 WebView、真实双标签、损坏存档恢复与玩家节奏均须继续验证。
PR #59 保持 Draft；禁止合并 main、发布 Pages/Cloudflare/Edge、修改正式导航或部署白名单、运行线上 Supabase SQL/迁移、制作作弊后门。
