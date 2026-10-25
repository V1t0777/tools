# P44 集成补丁：P2.60a 与 P2.45–P2.57 持锁接口兼容（未发布）

## 发现与复现
首次合并上游 `ac20644e` 后，GitHub Actions [40200342108](https://github.com/V1t0777/tools/actions/runs/40200342108) 的 Node 回归 **950 通过 / 6 失败**。六个失败测试文件均源于 `merge/normal-save-lock.mjs` 在 P2.60a 删除 `withNormalSaveLock` 导出，而仍有启动、动作、计时器、重置事务模块导入它。P44 自身 5 项与 P43 5 项导航测试全部通过。静态安全门禁已通过，不能把该 SHA 宣称全绿。

## 修复
- 保留 P2.60a 新增的 `commitNormalSnapshotLocked` 与独占锁常量，恢复旧事务模块需要的 `withNormalSaveLock` 非排队、失败即阻断接口。
- **两种 API 共享同一个 `NORMAL_SAVE_LOCK_NAME`**；旧游戏动作仍使用 `ifAvailable:true`，锁忙时拒绝，不等待后用旧基线重放。
- 新增跨接口竞争测试：旧事务占锁并写入时，新快照事务排队后重新读取基线并拒绝覆盖；同时验证缺失授锁和伪造回执安全失败。
- 此修复不接入 `merge/main.mjs`，不宣称旧标签的同步 `persist()` 已跨标签安全；上游 PR #58 仍需单独修复/验收该接口断裂。

最终验证须以**修复提交 SHA** 对应的 Node 全仓库回归、`bash scripts/security-check.sh` 与完整 Git 历史密钥扫描为准。PR #59 继续 Draft；不得发布或合并 main。
