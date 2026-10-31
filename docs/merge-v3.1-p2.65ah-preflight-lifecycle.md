# P2.65ah｜存档复核期间页面离开：旧按钮与确认重置禁止写入（2026-10-28）

## 已确认的发行阻塞

普通模式的 `revalidateResumedSave()` 先检查页面是否可见，再调用 `runtime.reconcile()` 读取当前存档。如果浏览器或测试注入在该同步 `getItem()` 期间触发 `pagehide` / `visibilitychange(hidden)`，且原始存档字节未变化，旧逻辑会因 `result.ok && !result.changed` 返回 `true`。调用者随后可能创建一个**在页面离开之后才开始**的 Web Lock 写入许可，绕过先前 `invalidate()` 的代次保护。

## 修复

- 只读复核完成后再次核验页面是否暂停、运行时是否 ready/blocked、UI 是否已有保存异常；任一失效直接拒绝旧事件，不执行玩家动作或确认重置。
- 继续由既有生命周期桥接器负责 BFCache/可见性复核；本轮不增加监听器、不引入无锁回退、不修改存档格式与经济。
- 保留现有存档原始字节、恢复前备份和剧情模式隔离；失败时仅提示重新回到页面操作，不自动重试破坏性操作。

## 专项故障注入

`tests/merge-locked-page-dom.test.mjs` 新增两项实际 HTML 入口 DOM 回归：

1. 已选原料的“收纳”按钮在存档读取期间收到 `pagehide`，不得写入。
2. 用户确认重置后，第二次存档复核期间页面隐藏，不得执行重置或创建异常备份。

两项均要求原始普通模式存档不变，剧情存档不变。Node 模拟不是 iPhone Safari/微信 WebView 真机验证。

## 验收与发行边界

本次变更必须在最新提交 SHA 的全仓库 Node 回归、`bash scripts/security-check.sh` / 部署隔离、完整 Git 历史密钥扫描全部成功后，才可记为 CI 通过。Cloudflare 实际部署记录仍须独立核对；未核实不得宣称部署安全。PR #58/#59 保持 Open/Draft，不合并 main、不改正式导航/白名单、不发布、不操作线上 Supabase。

下一轮继续真实双标签与 BFCache 组合、导入/导出/重置完整闭环；11 月 10 日是否推荐 RC 仍取决于真机与全部门禁证据。
