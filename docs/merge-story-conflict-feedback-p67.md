# 《云屿百物铺》剧情 P67 · 跨标签存档冲突反馈收敛（仅 Draft）

## 问题

P62–P66 已对剧情工作台执行操作前检查、Web Locks、精确原文 CAS、写后双重复核和旧 DOM 按钮隔离。但异步操作在锁释放后被其他标签覆盖、或渲染同步触发存档变化时，页面会进入保护状态，原先的 `board-notice` 成功提示却可能保留。玩家在 iPhone 小屏幕上可能同时看到「操作成功」和「存档冲突」，误以为需要重复交单或建造。

## 本轮改动

1. **提交不确定反馈**：写后首次复核失败时明确提示「可能已经写入，勿重复操作」；渲染后复核失败时撤回刚显示的成功提示，不重新执行引擎或写入。
2. **后台恢复与跨标签反馈**：`pageshow`、重新可见、外部 `storage` 事件导致本页失效时，立即替换此前成功提示，要求重新打开页面核对进度。仅故事工作台自身存档冲突会阻断；剧情进度变化仍只刷新建筑门槛。
3. **回归契约**：专项测试检查受保护状态先渲染、再更新 ARIA live notice，以及锁后、渲染后、恢复、跨标签四类路径均不保留误导性成功文案。

## 安全不变量与验收限制

- 只改提示与阻断后的界面表现，不改变 7×8 引擎、金币/体力、存档 schema、独立键、DLC 规则或写入协议。
- 失败不等于「未提交」：绝不自动重试、回滚、重置或覆盖存档；玩家须重新打开页面核对真实进度。
- `role=status`、`aria-live=polite` 继续用于 iPhone 辅助功能提示；自动化静态契约**不等于** Safari/微信 WebView 真机测试。
- 验证：`node --test tests/merge-story-conflict-feedback-p67.test.mjs tests/merge-story-workshop-publication-p62.test.mjs tests/merge-story-workshop-reset-publication-p63.test.mjs`、`node --test tests/*.test.mjs`、`bash scripts/security-check.sh`。最终以当前 SHA 的 GitHub CI 三项门禁为准。

PR #58/#59 保持 Draft；只允许带 `[CF-Pages-Skip]` 前缀的研发分支提交。不得合并 main、发布 Pages/Cloudflare/Edge、改部署白名单或运行线上 Supabase SQL。未完成真机与多标签验收前不得宣称可发布。
