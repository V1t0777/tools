# 云屿 V3.1 · P2.65az：普通经营经济卡局诊断门禁（未发布）

## 本轮目的

在已有真实引擎的低效率玩家模拟中，严格区分“模拟玩家没有整理导致的停滞”与“规则层面没有任何可执行解困动作”。此前 `hardDeadlockSessions` 只根据是否存在合成对、可交订单以及仓库是否已满判断，未检查玩家能否用已有金币合法扩容仓库，存在把可恢复局面误判为死局的风险。

## 变更

- `merge/economy-friction-simulator.mjs`：每次会话结束调用现有只读 `diagnoseBoard`，依据真实引擎存档判断 `hard-deadlock`；额外记录 `behaviorBlockedSessions`（模型选择不整理的停滞）及 `recoverableFullSessions`（满盘但有合法解困动作），并提供每日计数与期末恢复类别。没有自动清盘、赠送金币或更改生产/合成/订单数值。
- `tests/merge-economy-deadlock-classification.test.mjs`：48 条 30 日多种子轨迹（8 种子 × 3 行为 × 2 策略）、4 条 90 日低效率短会话轨迹、重复性与账本分类断言。**若发现真实规则死局则测试失败**，不能把模型停滞冒充引擎死局。
- 模型依然是固定概率的非理想行为假设，不是实际玩家数据。成功不意味着玩家不会觉得拥堵；也不证明 iPhone/微信触控、存档落盘或剧情工作台经济已通过。

## 验证

```sh
node --test tests/merge-economy-deadlock-classification.test.mjs tests/merge-economy-friction.test.mjs
node --test tests/merge-*.test.mjs
bash scripts/security-check.sh
```

GitHub Actions 还须核对**本轮最终 SHA**的全仓库 Node、静态安全与部署隔离、完整 Git 历史密钥扫描三项。未全部成功不得宣称门禁通过。

## 剩余阻塞与发行边界

P0：真实 iPhone Safari、微信 WebView 的原生文件选择、下载落盘、触控及后台恢复尚待真机验证；Cloudflare 后台实际部署状态无法从 GitHub Actions 推定。P1：剧情首卷与普通模式集成、长线经济真实玩家验证及 320px 极窄屏可用性仍待收口。11 月 10 日仅按证据评估是否可提交候选审阅，不自行发布。

本轮仅修改普通模式独立研发分支；保持 PR #58/#59 Open/Draft，不改 main、正式导航、部署白名单、线上 Supabase，不发布 Pages/Cloudflare/Edge，不制作作弊后门。
