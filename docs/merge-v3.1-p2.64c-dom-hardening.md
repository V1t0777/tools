# 《云屿百物铺》V3.1 · P2.64c 持锁候选页面 DOM 验证与故障回退加固

**状态：独立 Draft 研发分支；尚未替换正式试玩入口；不是 RC，也未部署。**

## 本轮同主题增量

1. **真实候选页面模块的轻量 DOM 交互回归。** 新增 `tests/merge-locked-page-dom.test.mjs`，在 Node 原生测试进程内注入最小 DOM、localStorage 与 Web Locks 接口，然后动态导入实际 `merge/main-locked.mjs`，触发真实页面注册的点击、拖拽、存档事件与重置回调。验证启动后棋盘合成、持锁保存、确认重置、异常原始字节备份、锁不可用时不写盘，以及跨标签经济分叉在拖拽过程中导致暂停、迟到点击不再写入。**这是浏览器接口模拟，不能冒充真实 iPhone Safari/微信 WebView 验收。**
2. **异步锁等待前捕获道具目标。** 修复候选页补给道具按钮在异步锁等待结束后才读取 `select.value` 的时序问题。现在点击时同步捕获 `producerId`，避免用户在保存期间更换工坊选择导致已提交的道具操作误指向其他工坊。新增受控锁延迟场景验证。
3. **阻断后的重置收紧。** `normal-page-runtime.mjs` 此前在任何 `blocked` 状态都允许调用方提供新的原始字节并尝试重置。现在只有明确识别为 `CORRUPT_SAVE` 或 `UNSUPPORTED_OR_CORRUPT_SAVE` 的异常原始存档，才能走“先备份后确认重置”的恢复入口。跨标签冲突、写入结果不确定、页面生命周期失效都必须重新打开页面核对，不能通过传入另一标签的最新字节绕过旧会话的安全阻断。两项专项测试验证不发生写入或异常备份。

## 质量门禁与部署隔离

执行目标：`node --test tests/merge-locked-page-dom.test.mjs tests/merge-locked-page-reset-guard.test.mjs`，并按 `AGENTS.md` 要求执行 `bash scripts/security-check.sh`。必须检查本次提交 **同一 HEAD SHA** 对应的全仓库 Node 回归、静态安全/部署隔离、完整 Git 历史密钥扫描，三项未全成功不得宣布完成。

本轮只修改 `merge/main-locked.mjs` 候选页和运行时模块、专项测试及本文档；**`merge/index.html` 仍加载 `main.mjs`**，没有切换试玩页面，不修改 `main` 分支、正式导航、部署白名单或剧情分支，不合并 Draft PR、不发布 GitHub Pages/Cloudflare/Edge、不操作线上 Supabase 数据库，也不实现作弊后门。

所有推送标题必须以 `[CF-Pages-Skip]` 开头。Cloudflare Pages 预览分支禁用设置尚未通过独立接口核实，推送后需要检查 GitHub 关联部署信息；若无法访问 Cloudflare 控制台，不能声称已独立确认无部署。

## 后续集成重点

下一阶段继续将 DOM 回归扩展到 BFCache、页面隐藏、锁忙、重复触控、存档损坏后的导出及原始恢复，检查旧同步页面源码切片测试的等价安全断言。随后在 **单一原子变更** 中切换 `merge/index.html` 的页面入口并完成旧测试迁移，保证四类写入路径不会出现混合持锁状态。真实设备及云端联调完成前不提出 RC。
