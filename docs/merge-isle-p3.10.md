# 云屿百物铺 P3.10：云指令队列崩溃恢复与幂等故障注入（仅未发布开发分支）

## 目标与变更

本轮仅增强未来云存档客户端的持久化队列错误分类，并在**纯内存权威服务器模拟**上进行故障注入。未连接真实 Supabase，不写线上 SQL，不部署 Edge Function；当前 P2 单机试玩、导航、Pages/Cloudflare 部署白名单和美术均保持不变。

现有 P3.1 队列已经在发送前持久化 `operationId`、`expectedRevision` 和尝试次数，并复用原操作 ID 重试。此前在网络返回不明、且浏览器拒绝写入退避时间（`nextRetryAt`）时，`networkFailure()` 的持久化失败会设置 `phase='storage-error'`，但调用方仍返回 `code:'NETWORK_UNAVAILABLE'`。这可能让上层误以为只需正常网络重试，忽略存储写入安全故障。

本轮将 `networkFailure()` 改为返回布尔持久化结果。只有成功保存退避信息时，才以 `NETWORK_UNAVAILABLE` 报告断网；写入失败、操作不在 journal 中时必须 **fail closed**，明确返回 `STORAGE_ERROR`。已有操作 ID、请求期望版本和未决记录绝不擅自重置。

## 新增 7 项故障注入

`tests/merge-cloud-crash-recovery.test.mjs`：

1. **服务端已提交、本地 ACK 持久化失败：** 先确认服务端只扣一次体力，重启后原指令 ID 和固定 revision 仍在，再重放返回幂等结果；不能重复扣费。
2. **服务端已提交、连接断开、退避写入也失败：** 必须报告 `STORAGE_ERROR`，而非掩盖为普通断网；存储仍保留已发送尝试及原 ID。
3. **发送前尝试标记写入失败：** 网络发送次数必须为零；重启后可以安全发送第一次。
4. **两条队列指令且首条 ACK 持久化失败：** 故障期间后续指令不能发送，重启后先幂等确认首条，再按新 revision 执行第二条。
5. **重启前记录的指数退避时间：** 到时前不得再次发送，到时后仍用相同操作 ID 和固定预期 revision 恢复。
6. **多次重启、连续丢失确认：** 所有重试保持同一操作 ID，服务端始终只执行一次；只有持久保存最终确认后才清空队列。
7. **结果不明后 journal 损坏：** 重启必须禁止排队/连接/发送，保留损坏原始数据，不自动重建空队列、不猜测已提交结果。

所有故障使用可控内存存储桩与 `createInMemoryAuthority()` 实现，不调用外部 API、数据库或真实用户存档。

## 复现与验收

```sh
node --test tests/merge-cloud-crash-recovery.test.mjs
node --test tests/*.test.mjs scripts/*.test.cjs
bash scripts/security-check.sh
```

最终以该开发分支最新提交对应的 GitHub Actions 游戏回归、静态安全/部署隔离以及完整历史密钥扫描结果为准。安全检查未通过时，停止进一步更改，不声明完成。

## 剩余风险

- 若设备真正掉电时浏览器或操作系统未将 `localStorage` 数据持久落盘，客户端无法保证保留所有字节；必须依赖服务端幂等日志提供最终防重。
- 若已保存 journal 损坏，本轮保留原始内容并阻断，而非自动修复；需另行设计经过用户确认的数据导出/恢复工具。
- 模拟器不验证真实网络丢包、跨地域延迟、数据库事务隔离、RLS、日志保留/回收及 iOS Safari、微信 WebView 后台进程回收行为。
- 后端操作 ID 唯一性、事务 CAS、鉴权和安全限流尚未在真实服务中完成验收，任何本地测试均不意味着云存档已经可发布。

**发行红线：** PR #58 始终保持 Draft。未经用户明确授权，不合并 `main`，不修改正式工具箱导航或部署白名单，不发布 GitHub Pages/Cloudflare，不执行 Supabase 线上 SQL 或迁移，不部署 Edge Function，也不推进美术素材。
