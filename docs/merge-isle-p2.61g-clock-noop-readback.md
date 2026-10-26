# 云屿百物铺 V3 · P2.61g 普通模式计时器无变化回执复核（未发布）

## 本轮问题
P2.47 的 `commitNormalClockWithLock` 在计时器无须恢复体力/冷却时，仅读取一次存档便返回 `verifiedBaseline:true`。旧版未协调标签仍可能在首次读取后改写原始存档，导致未来异步页面将过期快照当作已验证结果发布。

## 最小改动
- 无变化计时器分支在返回可信回执前，再读取一次 `SAVE_KEY` 原始字节。
- 与首次可信字节不一致时返回 `STALE_BASELINE`；读取失败时返回 `STORAGE_UNAVAILABLE`；均不携带可发布的 `state`，不执行写入。
- 有变化的计时器路径仍使用既有 `commitNormalSnapshot` CAS 与写后原字节核验；普通模式页面、重置、剧情及经济规则均不改变。

## 专项回归
`node --test tests/merge-normal-clock-transaction.test.mjs`：增加 3 项用例，覆盖无变化期间旧标签替换、末次读取异常及 UI 单飞门禁阻断过期结果。全仓库回归与 `bash scripts/security-check.sh` 必须在对应最新 HEAD 的 GitHub Actions 三项检查成功后方可记为通过。

## 未解决风险
第二次读取不是跨标签原子事务，旧版未协调标签仍可在末次读取后写入；所有页面写入路径必须一起迁移至统一 Web Locks，且 iPhone Safari/微信 WebView 需要真实跨标签验证。本轮不涉及线上数据库、Edge、Pages、正式导航、部署白名单或美术；PR 保持 Open/Draft，不发布。
