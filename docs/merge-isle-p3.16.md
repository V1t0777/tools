# 《云屿百物铺》P3.16 — 服务端只读操作凭据接口与共享限流（未发布）

> **红线：本阶段是未部署研发草案。** PR #58 继续 Draft；不合并 main、不更新 Pages/Cloudflare 的导航或部署白名单、不执行 Supabase SQL/迁移、不部署 Edge Function、不制作美术。真实 PostgreSQL、Edge、iPhone Safari 和微信 WebView 尚未验收。

## 研发内容

- `merge/cloud/receipt-lookup.mjs`：受信任服务端单条操作凭据只读服务。调用者只能使用已验证 JWT 解析的 UID，不接受请求中的 userId；仅返回操作状态和 request_hash，或者 not-found。不执行指令或领取奖励。
- `supabase/functions/merge-game/index.ts`：未部署 Edge 草案新增严格 `mode=receipt` 路由，要求精确键名 `mode,operationId`；沿用 JWT 校验、来源域限制、4 KiB 请求限额及 no-store 响应头。
- `supabase/drafts/merge-isle-p3.16-NOT-APPLIED.sql`：未执行的持久化按账户限流草案，60 秒固定窗口最多 12 次，超额原子拒绝。服务角色专用 SECURITY DEFINER RPC，表 RLS 开启；调用错误则服务拒绝读取。
- `tests/merge-cloud-receipt-lookup.test.mjs`：离线故障模拟，验证身份/参数边界、跨用户隔离、请求指纹、额度控制、异常隐藏、字段白名单及 SQL 草案约束。

## 隔离与安全约束

1. 一次只查询一个 UUID operationId。使用经 JWT 确认的账户分区，同时按 user_id 和 operation_id 限定查询；禁止客户端自报账户 ID。
2. 查询返回只有 `{request_hash,status}` 以及最小状态码；隐藏操作 ID、服务端异常、金币/订单、全量存档、存储元信息与其他用户内容。
3. 先执行原子限流，再查询历史操作日志；限流 RPC 缺失、返回意外值或数据库故障时按 503 阻断。不能回退到 Edge 实例内存额度。
4. 找不到记录是未知结果而不是未执行的证明；查到匹配也不授权自动清空、重放、恢复写入。P3.15 的本地原文哈希核对及人工复核仍然必要。
5. 与 P2 离线试玩、正式工具箱导航及两套部署白名单隔离。未做真实 SQL 执行、Supabase 服务端联调或 iOS 微信实机验收。

## 测试命令与剩余风险

```sh
node --test tests/merge-cloud-receipt-lookup.test.mjs
node --test tests/*.test.mjs scripts/*.test.cjs
bash scripts/security-check.sh
```

需要检查 GitHub Actions 三项：Node 全仓库回归、静态安全和部署隔离、完整 Git 历史密钥扫描。CLI 自动化通过也不是上线授权。

**后续尚需**：在一次性测试数据库验证 40+ 并发共享限流、RLS 与函数 EXECUTE 权限（尤其 PUBLIC 默认授权）、跨 Edge 实例一致性、错误/超时、用户撤销权限和日志脱敏。旧操作日志回收后将无法确定缺失记录的历史结果。上线前仍需设计有 TTL 与审计的生产级防滥用策略。
