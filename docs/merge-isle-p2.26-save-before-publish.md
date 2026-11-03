# 《云屿百物铺》V3 P2.26 · 游戏操作保存后再接受（未发布）

问题：原普通模式 commit 先更新内存状态，再写本地存档；写入失败后页面仍可能展示未持久化的经济和背包成果。

修复：新增 merge/save-transaction.mjs，使用 saveLocal 的精确原文基线校验，并在写入后读回确认。merge/main.mjs 的操作、体力自动恢复和用户确认重置，都在持久化成功后才修改全局内存状态；失败时保留原画面，冻结后续经济操作，不会在定时器中每秒盲目重试。跨标签 storage 事件保持只读。

回归：tests/merge-save-transaction.test.mjs 覆盖正常写入、旧标签竞争、异常/限额、虚假写入、重置和双模式隔离；更新 tests/merge-storage-safety.test.mjs 的重置接线断言，不放宽任何安全检查。

限制：仍然是同步 localStorage，尚未把 Web Locks 和异步 checkpoint 接入全部玩家操作、初始化迁移。写入后出错可能导致结果不确定，需备份和重新打开页面核对。尚未完成真实 iPhone Safari、微信 WebView 和跨标签并发实机测试。

边界：仅 Draft PR #58；不改 main、不合并、不部署、不运行线上 Supabase SQL、不制作美术或作弊后门。本提交 HEAD 对应的全仓库回归、静态安全/部署隔离和 Git 历史密钥扫描必须 3/3 全通过。
