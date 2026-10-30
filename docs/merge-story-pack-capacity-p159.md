# P159｜剧情包容量预检与真实存档预算一致性（2026-10-30，未发布）

## 问题
剧情包允许最多 1500 个节点，但故事存档对每类已完成节点最多保留 512 个，对每包选择字典最多保留 256 项。旧预检没有同步这些边界：较大的后续故事包可能开局合法，却在后期完成对白时因超出存档上限而卡关；每日事件还需要占用一个持久化日期固定标记。

## 实现
- `merge/mode-boundaries.mjs` 导出原有的 512/256 常量，不改变存档协议或验证行为。
- `merge/story/runtime.mjs` 在剧情包预检阶段逐类检查节点数量，并计算含选择节点的上限；存在每日事件时预留一个当日固定标记槽位。超过上限的包在注册前拒绝。
- `tests/merge-story-pack-capacity-p159.test.mjs` 验证现有首卷仍有效、512/513 节点边界、256/257 选择边界、255 选择加每日事件完成后的真实可存档状态。

## 边界
不新增 DLC、章节、奖励、云同步或经济系统；不会修改普通经营存档。该保护只解决确定的节点/选择条目数量限制，不能保证任意长 ID、多包累计大小都不会触及全局 128000 字符存档上限。CI 不代表 iPhone Safari、微信 WebView 或 Windows 真机验收。

专项命令：`node --test tests/merge-story-pack-capacity-p159.test.mjs`。全量：`node --test tests/*.test.mjs`、`bash scripts/security-check.sh`、完整 Git 历史密钥扫描。以最终 SHA 的三项 GitHub Actions 门禁为准。

发行边界：PR #59 保持 Draft；禁止合并 main、发布 Pages/Cloudflare/Edge、修改部署白名单或执行线上 Supabase SQL。11月10日仅尽力交付供用户终审的离线 Web 候选版，仍需另行发布授权。
