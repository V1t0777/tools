# P25｜剧情工作台确认重置的 ABA 防护（研发分支，未发布）

## 发现的问题
P23 已将正常经营和用户确认的工作台重置放入同一 Web Locks 协议，但重置使用 `createInitialState(now)`，其 `revision=0`。当浏览器/测试使用相同时间戳、或者重置前就是未游玩的初始状态时，重置后的 JSON 可能与旧快照逐字节相同（ABA）。旧标签的精确原文比较可能因此错误地认为旧快照未改变。

## 本轮修复
- 只在剧情独立工作台的有效旧存档上重置时，将新存档修订号设为 `old.revision + 1`，拒绝超过 `Number.MAX_SAFE_INTEGER` 的重置。
- `writeStoryWorkshop` 在 `confirmedReset=true` 且原始存档有效时再次强制新修订号大于旧值；对明确确认的损坏存档仍允许原始字节保全流程后的重置。
- 新增6项确定性测试：相同时间戳 ABA、旧标签回放、直接写入拒绝旧修订、溢出阻断、损坏记录确认重置、连续重置单调性及普通/对白模式隔离。
- 没有改动正式经济、存档键、普通模式、线上数据库或任何部署配置。

## 边界与待办
本次只修补 ABA/修订号安全，不代表无 Web Locks 环境已获得原子事务；不保证掉电后本地存储持久化。真实 iPhone Safari / 微信 WebView、后台恢复、文件下载及多人叙事内容质量尚未完成验收。上游 #58 本轮检查已领先当前故事分支所含基线6提交，暂不混入本次补丁以保持验证单一目标。

最终应以 `node --test tests/*.test.mjs`、`bash scripts/security-check.sh` 和最终 GitHub Actions 完整历史扫描的真实结果为准。PR #59 必须保持 Draft；不合并 main、不发布 Pages/Cloudflare/Edge、不更改导航或部署白名单、不执行线上 Supabase SQL/迁移、不接触生产数据、不制作作弊后门。
