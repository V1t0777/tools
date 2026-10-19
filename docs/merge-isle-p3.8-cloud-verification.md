# 《云屿百物铺》P3.8b — 云端快照验证状态防陈旧（未发布）

> 本文档补充原 `docs/merge-isle-p3.8.md`（棋盘整理提示）。本任务仅涉及未来云存档客户端的纯 JS 协调器、单元测试和文档，未接入当前 P2 本地试玩页面。

## 问题与修复

原 `merge/cloud/tab-coordinator.mjs` 的 `preview().verified` 仅检查 `verifiedRevision === result.revision`，忽略同版本快照内容变化：例如服务端基于时间计算了体力变化但操作 revision 保持不变；或另一标签页更新了本地已核验的快照。如果版本相同，旧标签可能错误展示“云端进度已确认”。

本轮使用**会话内、仅内存保留**的验证标识：`JSON.stringify([revision, state])`。只在该协调器的 **Web Lock 内**，本次队列实例实际完成服务端读取/动作确认且返回成功、`queue.preview().verified === true` 时建立标识。随后展示前重新从持久化 journal 读取最新快照并比对内容；其他标签页即使只改变同一 revision 的 `state` 也会使标记失效。JSON 原始内容比较是一种保守的完整性检查，不是密码学签名。

## 失败与状态展示

- 开始下一次独占操作即清除旧验证状态；锁请求尚未完成时不显示“已确认”。
- 网络重验失败、存档校验失败、持久化失败或 Web Lock 请求异常：撤销旧标记，不根据旧 revision 恢复成功状态。
- 锁请求失败标注 `LOCK_REQUEST_FAILED`；网络失败保留 `offline` 状态，供现有中文只读状态展示模块显示警告。
- Web Locks 不可用时继续拒绝云端操作；**不**使用不安全的 `localStorage` 假锁。
- `enqueue` 和其他未读取服务器的成功调用不会凭本地缓存建立新的“已验证”标记。

## 回归测试

在 `tests/merge-cloud-coordinator.test.mjs` 增加六种场景：

1. 第二标签同 revision、不同快照的服务端读取使原标签的核验标记失效。
2. 本地 journal 被改写但 revision 未变时失效。
3. 网络再次验证失败时失效并显示 offline。
4. 锁请求失败时失效，并提供阻断错误码。
5. 请求进行期间不可沿用上一次已验证状态。
6. 重新读取同一未改变的服务端快照后，恢复验证标记。

验证命令：

```sh
node --test tests/merge-cloud-coordinator.test.mjs
node --test tests/*.test.mjs scripts/*.test.cjs
bash scripts/security-check.sh
```

## 限制和上线前风险

- 标记只表示**本协调器最近一次成功验证的本地快照与现存缓存内容一致**。无法证明未来服务器永远不变化；多设备远端变更需要重新 `connect()` 或 `flush()`。
- 该标记不能替代服务端事务/CAS、RLS、幂等日志、审计或身份验证，也不能防护本机被恶意篡改；本地试玩资产不得混入正式云端账本。
- 真实 iOS Safari、微信 WebView、浏览器后台回收、Web Locks 可用性、慢网络及多设备端到端测试仍待完成。
- `JSON.stringify` 依赖已验证的有界存档 JSON 结构，当前队列持久化上限 160,000 个 UTF-16 代码单元；不同键顺序可能保守地使验证失效，不会形成假阳性。
- 本轮不修改正式工具箱导航、部署白名单、数据库 SQL、Edge Function、任何部署工作流或美术素材。未经用户明确授权，PR #58 必须保持 Draft、不得合并 `main` 或发布。
