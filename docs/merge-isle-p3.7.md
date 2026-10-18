# 云屿百物铺 P3.7 — 棋盘恢复诊断与经济账本审计（研发草案）

> 未发布；仅合成经营项目的独立纯 JS 诊断、安全测试。用户未授权前禁止合并 main、修改部署白名单和导航、部署 Pages/Cloudflare/Edge、运行 Supabase SQL 或制作美术素材。

## 背景
P3.3 30 日经济仿真发现成长和金币积累较快；P3.4 假设低频整理的玩家可出现几乎持续满盘。但是模拟中的「玩家未整理而卡住」不等于当前规则绝对无解。本轮不调整经济参数或已有游戏 UI。

## 文件
- \`merge/board-diagnostics.mjs\`：对已通过 P2 \`validateSave\` 的存档检查可交订单、同链同级（不含最高阶）可合成对、仓库取出、满盘存入和可支付仓库扩容，输出单条建议及 \`playable/waiting/recoverable/hard-deadlock\` 分类。只读、不自动执行。
- \`merge/cloud/economy-audit.mjs\`：核验每次可信操作的金币和经验变化是否与交单奖励、升级原价相符；拒绝凭空金币/经验、漏扣金币、非法修订号。**尚未接入正式 Edge 服务；不替代 RLS/JWT/SQL 事务验证。**
- \`tests/merge-board-audit.test.mjs\`：极端满盘、仓库存入和扩容、最高阶不合成、合法金额、伪造奖励和失败操作审计。

## 核心定义
\`hard-deadlock\` 仅指当前 P2 已实现动作之下：棋盘满、仓库满、无可交委托、无可合成对、也无可用金币和等级扩容仓库。未来如果增加出售、拆解或其他规则，诊断必须同步更新。位置交换、体力自然恢复不能凭空释放满格空间。诊断结果仅提供候选操作；实际执行仍须重验状态与云端 revision。

## 测试及后续
\`node --test tests/merge-board-audit.test.mjs\`，并通过 Draft PR 原有 \`node --test tests/*.test.mjs scripts/*.test.cjs\` 与 \`bash scripts/security-check.sh\` 门禁。下一阶段将此指标接入*研发报表*，区分行为停滞与真正无解，不能把模拟数值冒充真实用户留存。真实 PostgreSQL、手机浏览器和长期经济仍需独立验证。
