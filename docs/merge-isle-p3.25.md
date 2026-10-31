# P3.25 — 一次性 PostgreSQL 测试角色权限预检

仅针对未发布研发分支的本地一次性 PostgreSQL 测试工具。此前预检只要求 `anon`、`authenticated`、`service_role` 为 `NOLOGIN`，但不能排除它们拥有 SUPERUSER、CREATEDB、CREATEROLE、REPLICATION 或 BYPASSRLS 属性。

本轮增加只读 `pg_catalog.pg_roles` 检查：三个角色均不得具备上述集群级特权；在数据库建表、写入或执行 SQL 草案前，必须同时通过原有角色数量检查和新权限检查，否则拒绝执行。新增静态回归覆盖缺失安全角色、检查语句和先检后写顺序。

**验收边界：** Node 单元测试和 GitHub Actions 通过不等于真实 PostgreSQL RLS、40 会话并发、Edge 或 iPhone/微信 WebView 实测通过。本轮不启动 PostgreSQL、不运行线上 Supabase SQL、不部署 Edge/Pages、不合并 main，PR #58 必须保持 Draft。
