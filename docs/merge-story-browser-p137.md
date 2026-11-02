# P137｜首卷四章真实浏览器经营闭环（2026-10-30，未发布）

## 本轮改动
- 移除剧情 Chromium 长链测试中的三座建筑经济快照回灌；保留真实页面生产、合成、交单及建设按钮路径。**同一份真实浏览器存档**连续完成前 42 笔订单，支付花园 160 金币、港湾 330 金币、门面 60 金币，并阅读第四章结局达到 12/12。
- 港湾必须由第 42 笔订单后的实际等级和金币共同解锁；不满足时测试失败，不能回退到合法引擎快照冒充真实经营。
- 门面从已扣除港湾费用的同一存档支付，不再将另一份经济模拟快照写入 localStorage；保留跨标签防二次扣费、存档 revision、金币和经验不变量、普通模式隔离及结局重载检查。
- 移除该浏览器测试中不再使用的经济模拟依赖与旧的误导性诊断。单项超时由 360 秒调整至有界 420 秒（CI 工作流仍为 10 分钟），**不删断言、不跳过真实冷却、不修改经济或模拟时钟**。

## 证据与门槛
- 代码：`tests/merge-story-browser-real-p112.test.mjs`；运行 `node --test tests/merge-story-browser-real-p112.test.mjs` 及全仓库 `node --test tests/*.test.mjs scripts/*.test.cjs`。
- 运行 `bash scripts/security-check.sh` 与完整 Git 历史密钥扫描；本轮最终结论以最终提交 SHA 的 GitHub Actions 三门禁为准，**CI 尚未完成前不得宣称通过**。
- 这条链验证的是 **CI Linux Chromium** 的真实 DOM、浏览器存档与下载，并非 iPhone Safari、微信 WebView 或 Windows 离线真机验收。

## 风险台账（11月10日候选）
- **P0**：iPhone Safari / 微信 WebView / Windows 离线真机和损坏存档下载落盘仍未验收。
- **P1**：长链测试有真实工坊冷却，运行时间接近旧 360 秒上限；需观察最终 CI 耗时及偶发超时，不得靠移除操作或断言掩盖。
- **P1**：低效率玩家、资源耗尽、满盘及多种子经营虽有离线模拟，仍需真实交互回归与剧情节奏复核。
- **安全**：保持 PR #59 Draft；不修改 main、正式入口、部署白名单或生产数据；不发布 GitHub Pages / Cloudflare / Edge。所有提交保留 `[CF-Pages-Skip]`，检查新 SHA 是否出现意外 Cloudflare 部署。
