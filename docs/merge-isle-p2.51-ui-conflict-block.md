# 《云屿百物铺》V3 · P2.51 存档冲突后页面永久阻断门禁（未接入、未发布）

## 问题
P2.50 的 `invalidate()` 仅使当前在途回执失效；后续 `run()` 仍可启动。这适用于页面暂时隐藏、旧手势取消，但不能替代跨标签冲突、保存结果不确定时的“禁止继续操作”。否则后续动作可能在旧内存状态上被反复尝试。

## 本轮单一工程增量
为 `createNormalUiFlight()` 增加只读 `blocked` 状态和不可逆的 `block()` 方法：
- 调用 `block()` 时同步标记阻断并使在途事务 epoch 失效；重复调用幂等。
- 阻断后新 `run()` 立即返回 `UI_SAVE_BLOCKED`，不执行游戏动作或发布回调；在途结果即使持锁写入成功，也不得发布到已失效 UI。
- `invalidate()` 继续保留**临时**失效语义，不能清除 `blocked`；本模块没有 `unblock()`，必须通过重新加载并核验存档建立新门禁。
- `block()` 本身不写存储、不撤销已发生的保存、不自动取消 Web Lock，也不保证浏览器物理写入原子性。

## 专项回归与限制
扩展 `tests/merge-normal-ui-flight.test.mjs`：阻断前后禁止动作、在途回执不得发布、重复阻断幂等及临时失效仍可恢复。运行 `node --test tests/merge-normal-ui-flight.test.mjs`，并以**新 HEAD** 的全仓库回归、静态安全/部署隔离、完整历史密钥扫描三项 GitHub Actions 为准。

本轮**不改 `merge/main.mjs`**，目前真实页面仍使用同步保存，不具备端到端 Web Locks 保护。后续必须在实际页面对跨标签冲突和不确定保存调用 `block()`，对页面隐藏调用 `invalidate()`，并将启动迁移、动作、计时器、确认重置与异常备份全部接入同一锁。真实双标签、iPhone Safari、微信 WebView、PostgreSQL/Edge 均未验收。

PR #58/#59 保持 Open/Draft；不合并、不发布、不修改正式导航或部署白名单、不执行线上 Supabase 操作。
