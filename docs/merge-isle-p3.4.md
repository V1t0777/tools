# 云屿百物铺 P3.4 — 非理想玩家行为与棋盘压力仿真（仅研发，未发布）

本阶段只增加 `merge/economy-friction-simulator.mjs`、`tests/merge-economy-friction.test.mjs`、`scripts/merge-economy-friction-sim.mjs` 与本文档。**不修改 P2 游戏规则、经济参数、页面、部署白名单、Supabase 或美术。**

## 模型与假设

- 使用真实 P2 的 `produce`、`moveOrMerge`、`fulfillOrder`、`storeItem`、`withdrawItem`、`upgradeWarehouse`、`upgradeProducer`、`upgradeBuilding`；只由真实操作改变经济状态。固定虚拟时钟、LCG 随机种子，禁止访问真实存档、账号和网络。
- 每天 2 次，每次 12 分钟，操作假设 4 秒。`organized` 高频合成/交单，`casual` 低频整理，`cluttered` 极低频整理；还模拟仓库整理机会、错误交换、保留物品的倾向。这些概率**是人为设置的压力参数，不是玩家行为调查或真实留存数据**。
- 只有玩家策略选择成功时才合成、交付、存取；满盘时不会自动丢弃物品，也不会自动免费清空棋盘。`blockedSessions` 是**在该模型下玩家本次会话未采取有效解困操作的次数**；`hardDeadlockSessions` 只统计棋盘已满、仓库已满、没有可交订单或合成对的会话。前者不是数学意义上无解的死局或永久无法恢复。
- `save-coins` 不升级，`warehouse-only` 只升级仓库（4→6→8 格），`balanced` 按 P3.3 的正常升级优先级。`warehouse-only` 对比 `save-coins` 能更好隔离仓库容量变化，但仍受随机路径分叉影响，不能当成因果实验。
- 每日调用 `validateSave`，核对金币守恒 `余额 = 订单累计收入 - 升级累计支出`、动作账本、体力消耗、棋盘及仓库容量。不得把本模型当作运营 KPI 或商业收入预测。

## 30 日压力矩阵（每组 5 种子均值；每组 60 次会话）

| 行为 | 策略 | 订单 | 停滞会话 | 满盘会话 | 仓库存入次数 | 期末金币 |
|---|---|---:|---:|---:|---:|---:|
| organized | save-coins | 1037.4 | 0 | 0 | 0 | 44462.6 |
| organized | warehouse-only | 1043.4 | 0 | 0 | 0 | 44557.0 |
| organized | balanced | 1385.8 | 0 | 0 | 0 | 68283.8 |
| casual | save-coins | 43.0 | 59 | 59 | 4.2 | 1350.2 |
| casual | warehouse-only | 42.4 | 59 | 59 | 8.2 | 1130.0 |
| casual | balanced | 54.2 | 59 | 59 | 8.0 | 679.6 |
| cluttered | save-coins | 15.4 | 60 | 60 | 4.0 | 362.2 |
| cluttered | warehouse-only | 14.2 | 60 | 60 | 6.8 | 233.4 |
| cluttered | balanced | 20.4 | 60 | 60 | 6.4 | 54.2 |

## 解读与后续建议

1. **棋盘整理频率高度敏感。** P3.3 理想自动合成模型中 30 日无满盘；本次低整理率压力模型在前几次会话后接近持续满盘。两者是**情景上下界**，真实玩家行为未知，不能直接宣称游戏一定卡死。本次 45 条轨迹中 `hardDeadlockSessions` 均为 0，说明压力主要来自模拟玩家未及时整理，而非规则上完全无合法解困动作。
2. **仅增加仓库容量不足以解决极端整理不足。** casual 的仓库存入均值由 4.2 增至 8.2，但停滞会话仍为 59/60；仓库扩容不能代替合成引导和明确的满盘救援路径。需要独立验证 UI 能否引导用户发现可合成对、交单、仓库存取。
3. **压力模型里“卡盘”并非经济负债或真实 bug。** 棋盘可能仍有合法合成、交单动作，只是模拟玩家没有及时选择；应区分“物理无可行动作”和“行为停滞”。建议下一阶段新增可行动作枚举、可恢复性指标及新手整理提示方案，再决定是否需要额外经济消耗点。
4. **极端模型的产出下降不用于直接调参。** 模拟概率主观，随机种子只有 5 个；仓库-only 与 save-coins 的差异不能据此估算真实扩容付费价值。真实参数应通过用户授权的非敏感聚合事件和试玩观察验证。

## 复现与门禁

```sh
node --test tests/merge-economy-friction.test.mjs
node --test tests/merge-*.test.mjs
node scripts/merge-economy-friction-sim.mjs > friction-report.json
bash scripts/security-check.sh
```

测试中不读取用户个人存档，也不写入正式数据库。安全脚本和仓库完整回归以 GitHub Actions 为准。**PR 保持 Draft，不合并 main，不发布 Pages/Cloudflare/Edge，不运行 Supabase SQL 或迁移，不修改导航/白名单/美术。**