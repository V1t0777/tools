# 《云屿百物铺》P3.12 — 云队列组合故障提示优先级（未发布）

> 仅 Draft PR #58 / `feat/merge-isle-p0-p1` 的开发验证。不合并 main、不改正式导航或部署白名单、不部署 GitHub Pages/Cloudflare/Edge Function、不执行线上 Supabase SQL 或迁移、不推进美术素材。

## 问题

P3.11 已能展示未发送、结果未知、人工冲突及保存失败等云队列状态，但 `merge/cloud/sync-view.mjs` 原来**先**检测 Web Locks 缺失与 `LOCK_REQUEST_FAILED`，**后**检测 `phase:'storage-error'`。若两个问题同时出现，可能只显示“浏览器不支持安全云同步”或“独占锁获取失败”，没有告诉玩家**保留本地浏览器存储中的未决指令与损坏原始字节**。此时贸然清理站点数据可能删除唯一的未决操作证据。

## 本轮最小修复

- 把 `phase:'storage-error'` **或** `code:'STORAGE_ERROR'` 视作第一优先级，先提示“本地队列无法安全保存”“请勿清理浏览器数据”。即使同时存在 `lockAvailable:false`、`MULTITAB_LOCK_UNAVAILABLE`、`LOCK_REQUEST_FAILED`、`blocked:'conflict'` 或未决尝试，也不能掩盖存储损坏。
- 保持 Web Locks 安全限制：锁不可用时继续禁止云端操作，不引入不安全的 `localStorage` 假锁；健康存储下原有“不支持安全云同步”与“锁请求失败”警告保持不变。
- 仅修改**纯状态展示模块**，不更改 `merge/cloud/offline-queue.mjs` journal、云端事务、ID、重试、回滚及服务器协议；当前 P2 单机试玩页面不受影响。

## 自动化验收

新增 `tests/merge-cloud-status-priority.test.mjs` **9 项**，包括：

1. 同时存在存储损坏与 Web Locks 缺失。
2. `STORAGE_ERROR` 错误码与旧锁状态叠加。
3. 旧锁请求失败叠加新 journal 损坏。
4. 存储损坏与冲突/拒绝/协议错误/不明结果的优先级矩阵。
5. 实际损坏的持久化 journal + 无 Web Locks 的真实协调器状态。
6. 协调器先遇锁失败、随后本地存储被损坏。
7. 健康队列没有 Web Locks 时继续展示浏览器兼容提示。
8. 健康队列锁失败时继续展示独占锁错误。
9. 文字渲染和无障碍属性，确认不使用 HTML 解析器。

本地/CI 校验命令：

```sh
node --test tests/merge-cloud-status-priority.test.mjs
node --test tests/*.test.mjs scripts/*.test.cjs
bash scripts/security-check.sh
```

最终验收以本次提交 GitHub Actions 的 **Node 全量回归、静态安全/部署隔离、完整 Git 历史密钥扫描**实际结果为准。不得跳过旧有断言或降低安全门禁。

## 剩余风险

- 状态提示**不能修复损坏的 journal**，更不能判断服务器是否已执行结果不明的命令；损坏时仍保留原始数据、停止自动操作。
- Web Locks 只保证相同 origin 且主动使用同一锁的客户端标签页协调；跨设备必须依赖权威服务器事务/CAS/幂等记录、鉴权与 RLS。
- 未测试真实 iPhone Safari、微信 WebView、设备掉电、浏览器数据回收或实际数据库与 Edge 请求；这不是正式云存档已可发布的证明。
