# 云屿故事经营联动 P1 — 第一笔真实订单（未发布）

本阶段新增 `merge/story-workshop.html`，复用 V3 的真实 7×8 引擎、生产、合成和委托交付逻辑；工作台金币/体力/经验使用独立的 `toolbox.merge-isle.story.workshop.local.v1` 键，与普通模式 `toolbox.merge-isle.local.v1` 及剧情对白进度键都隔离。

## 首个可验证的剧情 → 经营 → 剧情循环

1. 进入故事，阅读抵达与旧招牌剧情；
2. 到剧情专属工作台生产或合成真实材料并交付 1 个订单；
3. 《第一杯热茶》才可以标记完成；此前可查看对白但不能完成；
4. 刷新或切换到普通模式，两个模式的金币、背包、订单互不迁移。

### 重要边界

- 首个联动条件只在剧情 UI 层检查。当前版本属于单机试玩，不是云端权威验证，也不作为防作弊机制。
- 已完成这一幕的旧存档不需要重新提交订单。更复杂的各章任务和建设目标尚未接入。
- 本地损坏存档原文保留，未显式确认不能重置；相同键多标签写入存在非原子竞态（读后另一个标签同时写入）。
- 目前剧情工作台只含合成、生产和交付核心，没有完整普通模式的仓库、补给和建筑界面；完整双模式体验尚未达到发布标准。
- 不修改正式部署名单，不发布 Pages/Cloudflare/Edge，不运行 Supabase 线上 SQL/迁移，不修改 main。

## 自动化与人工验收

执行 `node --test tests/merge-story-workshop.test.mjs tests/merge-story-runtime.test.mjs tests/merge-story-ui-contract.test.mjs`、全仓库 Node、`bash scripts/security-check.sh`。iPhone Safari、微信 WebView、Windows、断电/存储不足/多标签并发与无障碍实机验证仍待进行。
