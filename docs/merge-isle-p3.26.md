# P3.26 — PostgreSQL 一次性隔离探针：psql 子进程环境白名单

## 问题与范围

P3.25 预检已限制测试角色不得携带集群级特权，但此前 `querySync` 和 40 路 `queryAsync` 使用 `{...process.env,...env,PGHOSTADDR:''}` 启动 `psql`。外部 `PGOPTIONS`、`PGSERVICEFILE`、`PGPASSFILE`、`PGTARGETSESSIONATTRS`、`PGCONNECT_TIMEOUT` 等变量，以及与数据库无关的进程环境数据，可能意外继承至数据库命令。

## 本轮修改

- 在 `scripts/merge-receipt-pg-preflight.mjs` 新增纯函数 `disposablePsqlEnvironment(env, hostEnv)`。
- 两条 `psql` 执行路径均调用该函数，不再透传 `process.env`；只传本机 `psql` 命令查找所需的 `PATH`（Windows 可用 `Path` 和 `SystemRoot`）、锁定的数据库连接字段，以及固定 `LANG=C`、`LC_ALL=C`、`PGCLIENTENCODING=UTF8`、`PGCONNECT_TIMEOUT=5`。
- 显式固定 `PGHOSTADDR=''`、`PGSERVICE=''`、`PGSSLMODE='disable'`，拒绝从调用者或父进程继承其他 libpq 环境选项。
- 新增 3 项 Node 回归测试：父进程污染模拟、调用者额外字段过滤、同步和并发子进程均使用白名单的结构检查。

## 验收界限与风险

此改动仅影响尚未运行的本地一次性数据库探针，不执行草案 SQL 或线上连接；测试只验证环境构造与代码调用链，**不构成真实 40 会话并发、RLS、角色 ACL 或 Edge 端到端验收**。用户本机需自行准备完全独立、全新的 PostgreSQL 集群及空数据库；仍应按 P3.17–P3.25 预检约束执行，禁止连接共享或生产实例。

本轮不修改正式部署入口/白名单、工具箱导航、游戏美术，不合并 `main`，不发布 Pages/Cloudflare/Edge，不执行任何线上 Supabase SQL/迁移。PR #58 必须保持 Draft；验收以最新完整 GitHub Actions 全仓库、安全、历史密钥扫描为准。
