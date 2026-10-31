# 《云屿百物铺》P3.21 — PostgreSQL 模式前缀判定修复（未发布）

> Draft PR #58 的云存档研发修复。严禁合并 main、发布 Pages/Cloudflare/Edge、执行线上 Supabase SQL/迁移或修改美术。

## 问题与修复

P3.20 使用 `nspname NOT LIKE 'pg_%'` 识别 PostgreSQL 系统模式，但 SQL LIKE 中的下划线表示任意一个字符。因此 `pgfoo`、`pgX`、`pg1` 等自定义模式可能被错误排除在空库检查之外。

P3.21 改用 `pg_catalog.left(nspname,3) <> 'pg_'`，精确识别字面量 `pg_` 前缀，避免误把其他 pg 开头的模式当作系统模式。仍保留既有 public、pg_catalog、information_schema 特例。

## 验证

补充两项 Node 回归，检查精确前缀、常见反例和前置空库校验仍先于写入。须以当前提交的 GitHub Actions 全量 Node 测试、静态安全/部署隔离及全历史密钥扫描作为研发验收。

## 未完成

尚未启动独立 PostgreSQL 集群，未实际执行 40 会话并发、真实权限/RLS 验证。空库指纹读取与首次写入之间仍有时间差；脚本只可用于完全隔离、全新且可销毁的本地集群，不可在现有数据库或线上 Supabase 运行。Edge 和 iPhone/微信实机仍待验收。
