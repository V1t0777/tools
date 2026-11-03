# 云屿 V3.1｜P2.65by：低效率经济与满盘阻塞分类（未发布）

## 本轮目标

10 月 30 日发行阻塞专项：原有经济模拟器将“棋盘已满、当前模拟策略停止生产”统一记为 boardFullSessions，但模拟器不使用仓库，因此该计数不能直接解释为游戏规则死局。本轮在**不改玩家经济数值和普通模式运行时**的前提下，使用已有只读 diagnoseBoard 对每次满盘停顿分类。

## 变更

- `merge/economy-simulator.mjs`：增加 recoverableFullSessions（存在真实规则内的交单、合成、仓库收纳或扩容出路）与 hardDeadlockSessions（当前诊断没有合法腾挪路径），同时按天记录。严格要求两者之和等于原有 boardFullSessions。
- `tests/merge-economy-simulation.test.mjs`：对三种策略、四个随机种子、每次 4 分钟、持续 60 天的低效率经营做分类账本核验；对工坊 12 次耗尽、45 秒冷却边界及零体力等待恢复执行真实引擎转移验证。

## 解释与发行边界

- 这是离线确定性模拟，不是玩家行为实测；recoverable 表示规则允许人工整理，不代表模拟器已替玩家执行整理，也不能证明所有真实玩家不会卡局。
- hardDeadlockSessions 若非零，必须在 11 月 10 日候选决策中列为经济阻塞证据，不能以“全套测试通过”掩盖；若为零，也仅覆盖这些种子和策略。
- 不新增作弊、清盘、自动删除物品或云端功能；不修改故事源文件、正式导航、main、部署白名单、Supabase 数据或部署流程。
- 所有提交保留 [CF-Pages-Skip]；PR #58/#59 保持 Open/Draft。须在最终 SHA 的 GitHub Actions 核对全仓库 Node、静态安全与部署隔离、完整 Git 历史密钥扫描；未通过不得宣称验收完成。
- iPhone Safari / 微信 WebView 的文件选择、下载、后台恢复和真实 Cloudflare 部署状态仍须独立验证，不能据此宣布 RC。
