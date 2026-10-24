# 云屿百物铺 P3.2 — 跨标签互斥和网络结果不明保护

**状态：仅开发分支代码，未公开发布，未执行 SQL，未部署 Edge，不接入正式游戏 UI。**

## 设计与安全边界

1. `merge/cloud/tab-coordinator.mjs` 使用与玩家 UID 绑定的 Web Locks 独占锁；每次进入锁后新建 P3.1 队列实例，从持久存储重读最新版 journal。锁保护「入队—持久化」「远端读取—首次发送—提交结果—持久化」「主动取消」全过程，避免不同标签旧内存覆盖新数据。
2. Web Locks 缺失或失败时采用 fail-closed：禁止提交 / 取消 / 入队云端指令；**不使用未经证明可原子化的 localStorage 自旋锁作为降级**。这只限制将来的**云端队列**；现有 P2 本地试玩不受影响。
3. **全部云端操作必须走 coordinator**，不得与原始 `createOfflineCommandQueue` 混合写入相同 key；Web Locks 仅协调相同 origin 内、同一锁名的自愿参与者。跨 origin 的数据库冲突仍由 P3 服务端 CAS + 操作幂等约束保护。
4. `merge/cloud/timeout-transport.mjs` 的读/写超时分别默认为 12s / 15s。请求超时不能判定失败，重试时必须保留第一次提交的 `operationId` 和 `expectedRevision`；服务端使用唯一操作日志返回当前权威快照，不能双重奖励。
5. 请求超时以 AbortController 最佳努力取消连接，但服务器可能已提交事务；底层 transport 可不响应 AbortSignal。因此仍必须依赖服务端幂等，而不能凭本地取消推断未执行。
6. 客户端 localStorage 的试玩余额绝不可导入/覆盖云端权威余额。仅已验签身份的服务端可产生货币奖励，真实 API 和 RLS 仍须独立验收。
7. 页面重启后 journal 可以恢复，但本地缓存的 `verified` 必须重新进行服务器校验；不同标签改动后旧 `verifiedRevision` 不再为真。

## 前端接入先决条件

- Cloudflare 的安全 Origin 下必须验证 `navigator.locks` 可用性；不支持时显示明确的「该浏览器暂不支持云同步」提醒，不做不安全隐式降级。
- 统一通过经过认证的 fetch `transport` 调用服务端。只有在真实 JWT / Edge / SQL 完成隔离环境安全验收后才能接入正式存档。
- 应补充跨标签/多设备真机压力测试（iOS Safari、微信内置浏览器、桌面双标签与刷新/崩溃）、超时测试、低电量/省流量测试。
- 真实 PostgreSQL 的行级锁、RLS、权限、限流、日志老化和多区域延迟尚未验证。没有此验证不能将模拟结果标记为上线完成。

## 开发验证

新增 `tests/merge-cloud-coordinator.test.mjs` 和 `tests/merge-cloud-timeout.test.mjs`，可使用 `node --test tests/merge-cloud-*.test.mjs` 执行；提交 PR 后仍必须经过仓库完整安全扫描及回归工作流。

**提醒：用户未明确授权发布前，不合并 main，不修改 Pages / Cloudflare 部署配置，不执行数据库迁移，不部署 Edge Function。美术在独立窗口。**