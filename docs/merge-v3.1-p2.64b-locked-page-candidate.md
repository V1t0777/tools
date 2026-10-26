# 《云屿百物铺》V3.1 · P2.64b 普通模式统一事务页面候选

**研发状态：独立分支、未接入、未发布；不是 RC。**

## 目标与本轮实际边界

为了缩短研发周期，停止逐小时增加零散辅助模块，集中完成普通模式的**完整页面事务接线候选**。本轮新增 `merge/main-locked.mjs`，以现有真实 `merge/main.mjs` 的经营 UI 为基础，整体替换四类写入入口；但 **`merge/index.html` 仍加载原 `main.mjs`，不会自动启用候选**。这是为了让已有针对旧页面同步 CAS 的源码切片测试和真实浏览器验证可以在最终切换前一次性迁移，避免生产/预览页面出现部分写入路径持锁、部分未持锁的混合状态。

## 同主题集成的四项功能

1. **异步启动和安全发布**：初始化先显示“正在核验”且禁止写入；`runtime.start()` 在同名 Web Lock 中执行旧版迁移、备份及精确读回。只有 `onVerified` 收到可信快照才发布状态；锁不可用、原始存档损坏、读取异常时停止操作并保留原始字节导出。
2. **玩家操作与移动端拖拽**：原料合成、工坊生产、委托、仓库、升级、补给等继续通过统一 `commit(operation)` 进入 `runtime.action()`；操作在锁内对原始存档重新检查后才执行。选中格与仓库槽位在调用时捕获，避免异步提交读取后来改变的 UI 选择。存档未就绪/单飞中不再接受新的棋盘动作或拖拽。
3. **计时器与生命周期**：每秒可见计时器只经 `runtime.clock()` 写入；单飞和后台页面跳过。跨标签、focus、visibilitychange、pagehide、BFCache 统一由 `attachNormalPageLifecycle()` 处理，只读核验、旧手势取消、失败时阻断，不在事件回调中自动迁移或写盘。
4. **确认重置与原始数据保护**：明确确认后调用 `runtime.reset()`，受同一 Web Lock 保护。异常原始存档仅可在持有启动时观察到的原始字节且备份成功后覆盖；跨标签分叉、锁不可用或写入结果不确定时不允许直接重置。

## 本轮验证

新增 `tests/merge-locked-page-candidate.test.mjs`：检查候选文件为可解析 ESM、四类事务均接入同一运行时、无旧同步 CAS 写入、生命周期只读、异步交互门禁、异常重置原始备份以及 **`index.html` 仍指向旧页面**。此前 `merge-normal-page-runtime`、`merge-normal-page-lifecycle`、`merge-normal-page-receipt-metadata` 等真实事务模块组合测试继续作为基础回归。

`AGENTS.md` 要求执行 `bash scripts/security-check.sh`，且必须核对当前提交 SHA 的全仓库 Node 回归、静态安全/部署隔离、完整 Git 历史密钥扫描。受当前工作环境无法完整克隆仓库的限制，本轮可通过 GitHub Actions 对**实际提交 SHA**执行相关命令；不能把静态检查冒充浏览器实机验收。

## 已识别的下一轮切换阻塞

现有大量旧测试通过从 `main.mjs` 截取同步 `commit(result)`、`persist()`、`revalidateResumedSave()`、storage/timer 事件源码进行 VM 模拟。直接替换 live `main.mjs` 会让这些测试因接口已变而失效，不能通过删除断言或弱化安全门禁强行绿灯。下一阶段需要先为候选增加真实 DOM 交互的测试夹具，覆盖启动失败、锁忙、成功动作、拒绝动作、拖拽晚到点击、后台恢复、跨标签存档替换和重置；然后在**一个原子提交**中切换页面入口、迁移旧测试并完成三项 CI。实机 iPhone Safari/微信 WebView 仍需用户验收，云端/真实 PostgreSQL/Edge 仍未联调。

## 安全与发布隔离

此轮只新增候选模块、专项测试和中文文档，不修改 `main`、`merge/index.html`、正式导航、部署白名单或剧情分支；不合并 PR、不发布 GitHub Pages/Cloudflare/Edge、不运行线上 Supabase SQL/迁移、不做美术/作弊后门、不提交密钥。PR #58/#59 保持 Open/Draft。Cloudflare 控制台预览分支禁用设置仍未通过独立接口核实，提交必须以 `[CF-Pages-Skip]` 开头，推送后检查关联部署记录。
