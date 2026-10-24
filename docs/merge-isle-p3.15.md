# 《云屿百物铺》P3.15 — 损坏队列幂等操作凭据只读核验（未发布）

> 独立云存档研发模块，不接入当前 P2 离线试玩；PR #58 持续 Draft。禁止合并 main、变更正式导航或部署白名单、部署 Pages/Cloudflare/Edge、执行线上 Supabase SQL/迁移，禁止本窗口制作美术素材。

## 问题与目标

P3.14 已支持损坏记录分类和玩家明确确认后的本地原文取证，但云端指令存在“服务端已经提交、浏览器未收到确认”的情况。不能把“服务端未找到记录”理解成“没有执行”（幂等日志可能回收、后端暂不可用、记录不完整）；不能只凭 revision 判断一次操作是否执行。

新增 `merge/cloud/recovery-receipts.mjs` 的 `reviewDamagedJournalReceipts()`：对本地存在且 JSON 可解析、生产 validator 判定损坏的 v1 journal，严格提取可核对的操作 ID、expectedRevision、action、attempts，复用 `normalizeCommand` / `hashOperation` 与由**可信服务端上下文**提供的只读 `findOperation(uid, operationId)` 核对数据库中保留的 request_hash/status。默认返回不含任何用户 ID、操作 ID、指令内容的纯计数与状态码。

## 安全不变量

1. 没有显式 `confirmedByUser===true` 不读取本地原文，也不调用外部凭据查验。
2. 非字符串、缺失、过大、JSON 损坏、用户 ID 不匹配、版本不兼容、待决 ID 大小写重复、指令不符合生产白名单、曾发送但没有原始 expectedRevision：全部拒绝网络核验。
3. 仅对 `attempts>0` 且保留原始 revision 的完整规范化指令匹配 SHA-256；对于 `attempts===0` 的队尾仅显示数目，不把“未记录发送”当成“服务器肯定没执行”。
4. 找到匹配 hash 的 `applied` 或 `rejected` 凭据只表示这次读取看到了匹配记录；找不到、查询失败、凭据格式不合法或 hash 不符都必须阻断。异步查验后重新读取原始 journal 比较全字节，变化时旧结论失效。
5. **所有结果**均为 `readyToReset:false`、`readyToReplay:false`、`canResumeCloudWrites:false`、`remoteVerified:false`。没有“自动恢复”按钮、数据库写入、网络命令重发、清空存储或奖励结算。
6. `findOperation` 必须来自服务端授权且只读的持久幂等日志；**不能**把浏览器上传的记录或未经认证的 API 返回当作可信凭据。本阶段没有连接真实 Supabase、Edge，也不接入 P2 界面。
7. 该状态检查不持有浏览器 Web Lock 或数据库事务快照，且无法阻止其他设备在查验后再写入；因此匹配仅用于人工审查材料，永远不能作为恢复写入许可。

## 核验结果

- `MATCHED_RECEIPTS_REVIEW_REQUIRED`：所有有发送记录的指令都被回调报告为匹配；仍须人工审核，不能重放或清空。
- `LEDGER_ENTRIES_MISSING`：有些服务端记录缺失或已回收，结果未知；严禁把缺失视为未执行。
- `OPERATION_FINGERPRINT_MISMATCH`：相同 ID 的请求内容与服务端 hash 不一致，应优先排查数据污染或 ID 复用。
- `INVALID_LEDGER_RECORD`、`TRUSTED_LEDGER_READ_FAILED`、`LOCAL_EVIDENCE_CHANGED`：内容/访问或并发可信度不满足，不形成恢复决策。
- `NO_RECORDED_SEND_ATTEMPTS`：本地保留的可解析条目未记载发送尝试，但也不证明不存在历史云端操作。

## 验证

新增 `tests/merge-cloud-recovery-receipts.test.mjs`：完整模拟数据库已提交但 ACK 丢失、已拒绝的指令、服务端凭据缺失、同 ID 不同请求、伪造或格式错误记录、断网、队尾未发送、跨标签修改、最终本地读取失败、超限及跨用户数据。

应运行 `node --test tests/merge-cloud-recovery-receipts.test.mjs`、`node --test tests/*.test.mjs scripts/*.test.cjs`、`bash scripts/security-check.sh`，并检查 GitHub Actions 中完整历史密钥扫描、静态部署隔离及全部测试 3/3 成功。

## 尚未解决

真实服务端只读取证入口的身份授权、日志回收策略、查询限流、时间窗口与审计、跨设备排它事务和 iPhone Safari/微信 WebView 测试仍未完成。没有真实后端端到端验收，不具备发布条件。
