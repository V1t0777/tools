# 《云屿百物铺》V3 · P2.56 计时器零写入回执的基线证明（未发布）

## 问题
P2.47 的 `commitNormalClockWithLock()` 在锁内只读校验 V3 原始字节，若体力和冷却未变化，返回 `CLOCK_UNCHANGED` 并零写入；但原回执未显式携带 `verifiedBaseline`。P2.50–P2.55 的 UI 门禁因此对 `changed:false,status:'CLOCK_UNCHANGED'` 设有特例，允许仅凭这两个自报字段绕过读回/基线证明。若未来接线错误或组合事务返回伪造回执，门禁可能发布未经验证的页面状态。

## 单一安全增量
- `merge/normal-action-transaction.mjs`：真实计时器零变化路径在同名独占 Web Lock 内精确比对 `expectedRaw` 后，显式返回 `verifiedBaseline:true`；仍然不写盘、不提升 revision。
- `merge/normal-ui-flight.mjs`：移除 `CLOCK_UNCHANGED` 的免证明例外。任何成功回执都必须提供 `verifiedReadback:true`（写后精确读回）或 `verifiedBaseline:true`（锁内精确基线复核），否则永久阻断旧页面继续写入。
- 专项回归：真实引擎零变化计时器经 UI 门禁发布且零写盘；没有基线证明的同名伪回执被拒绝并阻断；既有启动与普通动作回执路径保持兼容。

## 验证与限制
执行 `node --test tests/merge-normal-clock-transaction.test.mjs tests/merge-normal-ui-flight.test.mjs`；再以本提交 HEAD 的 GitHub Actions 全仓库回归、静态安全与部署隔离、完整 Git 历史密钥扫描结果为准。没有全绿不得宣称完成。

这只是未接入页面的独立事务契约收紧，不等于实际游戏跨标签写入已经原子化。仍须统一迁移 `merge/main.mjs` 的启动、操作、计时器、异常备份及确认重置；真实 iPhone Safari/微信 WebView 和双标签验收未完成。

PR #58/#59 保持 Open/Draft；不合并 main、不发布 Pages/Cloudflare/Edge、不修改正式导航或部署白名单、不执行线上 Supabase SQL/迁移、不制作美术或作弊后门。
