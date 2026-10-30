# 云屿百物铺 · P40 普通事务失败与剧情双存档隔离（仅研发，未发布）

## 范围
- 合并上游 PR #58 的 P2.56：普通模式计时器零写入回执必须证明锁内基线一致；普通 UI 不再接受仅凭 CLOCK_UNCHANGED 自报状态绕过验证的回执。
- 新增 `tests/merge-story-cross-mode-failure-p40.test.mjs`：使用同一个内存存储适配器运行真实普通模式事务、普通 UI 门禁和独立的剧情存档读写。
- 普通模式动作写入故障时，门禁永久阻断后续旧页面写入；剧情对白与剧情工作台原始字节均保留。剧情独立事务仍能继续保存合法的「一封迟来的信」选择，不共享普通模式锁或金币/背包。
- 普通模式锁内零变化计时器必须携带 `verifiedBaseline:true`，在 UI 通过审核后不改变任一模式的存档。
- 剧情对白存档损坏时，普通模式只读计时器不主动清理或重建坏档；测试同时检查未改变剧情工作台。

## 验证
`node --test tests/merge-story-cross-mode-failure-p40.test.mjs tests/merge-normal-clock-transaction.test.mjs tests/merge-normal-ui-flight.test.mjs`
`node --test tests/*.test.mjs`
`bash scripts/security-check.sh`
最终 GitHub CI 三项状态须单独核对；不能将静态测试等同真机联调。

## 仍未解决
普通事务模块尚未接入普通模式 `merge/main.mjs`；这些故障注入测试不证明所有已部署旧页面能遵守 Web Locks。
单纯浏览器内 CAS 无法保证跨标签原子性；iPhone Safari、微信 WebView、BFCache、两标签竞争和真实磁盘掉电仍需人工与端到端测试。
无代码触及 main、导航、部署白名单、Cloudflare、Pages、Edge 或 Supabase 线上数据库；PR #58/#59 保持 Draft，禁止发行。
