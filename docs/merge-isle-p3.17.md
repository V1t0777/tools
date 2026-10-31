# 《云屿百物铺》P3.17 — PostgreSQL 权限与并发预验收、取证超时阻断（未发布）

> 范围：独立游戏云存档研发。PR #58 保持 Draft。绝不合并 main、更新正式导航/构建白名单或部署 Pages/Cloudflare/Edge；绝不执行现有线上 Supabase SQL/迁移；不制作美术。

## 目标与本次改动

1. `merge/cloud/receipt-lookup.mjs`：新增默认 5 秒（可配置，1～30000 毫秒）的服务端只读凭据查询期限。共享限流 RPC、单条历史凭据查询任一阶段超时，直接返回 503，不提供绕过限流或自动恢复分支；迟到结果不得将失败转为成功。使用 Promise.race 的期限无法保证取消已发送的 PostgreSQL 请求；RPC 可能已经扣除查询额度，不能作为事务撤销机制。
2. `scripts/merge-receipt-pg-preflight.mjs`：**必须明确传入** `--confirm-disposable-db` 与 `MERGE_RECEIPT_TEST_DB_URL`，协议仅 postgres/postgresql，地址只允许 localhost、127.0.0.1 或 ::1，数据库名必须 `merge_receipt_test_` 前缀；拒绝现存 `auth.users` 的数据库。测试可能创建本机 PostgreSQL 集群 NOLOGIN 角色，只能在一次性 PostgreSQL 实例内执行。
3. 该预验收脚本实际运行时，将建立最简本机 auth.users 测试替身和角色、执行**副本** P3.16 SQL 草案，校验 RLS 标志、PUBLIC/anon/authenticated 的 table/function 权限、service_role EXECUTE；再使用 40 个独立 psql 会话竞争同一 UUID 的限流额度，要求 12 成功、28 拒绝、计数封顶 13；最后检查另一账户独立额度及 60 秒窗口重置。**脚本没有在当前环境执行 PostgreSQL**。
4. `tests/merge-cloud-pg-preflight.test.mjs`：CI 中运行的纯 Node 自动化检查。对线上 URL 误入、数据库名、隐式执行、SQL 授权约束、超时、后到应答、错误隔离进行独立回归。该检查**无法替代**真实 40 并发 PostgreSQL 运行或 RLS 拒绝测试。

## 一次性本机验证（仅隔离的新 PostgreSQL 测试实例）

如果用户另外授权本机临时 PostgreSQL 环境，并已自行建立一个未使用的测试数据库，例如 `merge_receipt_test_scratch`，可执行：

```sh
MERGE_RECEIPT_TEST_DB_URL='postgres://tester@127.0.0.1:5432/merge_receipt_test_scratch' node scripts/merge-receipt-pg-preflight.mjs --confirm-disposable-db
```

脚本会创建 auth.users 模拟表、可能创建本地集群角色、写入限流记录，**切勿对已有 Supabase 本地或云端项目执行**。使用一次性本机容器/集群，验证后销毁整个容器及测试数据库。脚本不回传凭据、原始账号或真实游戏数据。

## 安全策略

- 不允许普通用户自报 UID；Edge 仍沿用 JWT 身份和按账户单条操作查询。
- 不允许请求失败、没有服务端凭据或客户端重新连接时自动清除/重放本地云队列。
- 仅保留受信任服务端在 `service_role` 下执行被严格授权的 RPC 方案。`SECURITY DEFINER` 必须对 PUBLIC、anon、authenticated 全部 REVOKE，不能依赖 RLS 代替函数级权限。
- 未部署共享限流 SQL 时接口必须不可用；客户端或 Edge 实例内存计数不构成跨设备共享保护。
- Supabase 2026-10-30 的 Data API 自动暴露默认配置变化需要另行回归验证；当前草案显式赋予 service_role 并撤销公共权限，不暗自放开数据库访问。

## 自动回归

```sh
node --test tests/merge-cloud-pg-preflight.test.mjs
node --test tests/*.test.mjs scripts/*.test.cjs
bash scripts/security-check.sh
```

正式验收以该提交 GitHub Actions 的完整 Node 回归、安全静态及部署隔离、完整历史密钥扫描为准。剩余未实测：真实 PostgreSQL 事务争用、角色登录与权限、Edge 运行时网络中断/取消、跨设备 iPhone Safari/微信 WebView；因此不可发布。
