# 云屿百物铺 V3.1 · P2.63 统一页面事务的发布后复核与浏览器生命周期桥接

**状态：研发分支阶段性实现；尚未接入现有 `merge/main.mjs`，禁止发布。**

## 本轮一次性闭环的三个相关问题

1. **事务成功不等于 UI 发布时仍可信。** `normal-page-runtime.mjs` 的 Web Lock 在回执返回后已经释放。若旧标签或同步 UI 回调在这段时间更改 `SAVE_KEY`，过去的动作、计时器、启动或重置可能返回成功。本轮在所有 `onVerified` 发布前后重新比对精确原始字节。回读不一致一律拒绝发布、阻断进一步写入；不能把可能已落盘的结果谎称为已回滚。
2. **真实浏览器生命周期需要一个统一只读入口。** 新增 `normal-page-lifecycle.mjs`，把跨标签 `storage`、可见性、`pagehide`、BFCache `pageshow.persisted` 和 `focus` 统一接到 `runtime.reconcile()/invalidate()`。只接受当前 localStorage 区域及普通模式 `SAVE_KEY`（或 `clear()`），隐藏页面不抢先更新，离开页面取消旧手势，在途事务必须失效。
3. **避免恢复前台时旧拖拽或重入回调污染状态。** 观察到不同原始字节时，先调用同步手势取消钩子，再交给运行时验证和发布。生命周期通知只允许同步；嵌套 storage 回调、存储不可访问、回调抛错/异步结果或通知后原始字节再次变化均阻断，而不是继续游戏。

## 专项回归

`node --test tests/merge-normal-page-lifecycle.test.mjs`

12 项覆盖启动/动作/计时器/重置四类发布时原始字节遭同步篡改、无关 storage 事件过滤、合法跨标签计时同步、同 revision 经济分叉阻断、BFCache/焦点与隐藏页面、pagehide 取消手势、重入事件、存储拒绝访问和解绑。另保留此前 `merge-normal-page-runtime.test.mjs`、`merge-normal-runtime-publication.test.mjs` 等完整链路回归。

**Node 内存存储和模拟 Web Locks 不是双标签真实浏览器或 iPhone Safari/微信 WebView 验收。**

## 为什么仍不直接替换 `main.mjs`

当前页面有 4 类同步写入：`loadLocal/prepareNormalStartup`、`commit/persist`、可见计时器、异常备份/确认重置；还存在 `revalidateResumedSave`、`storage` 和 BFCache 等旧生命周期回调。只迁移其中一类会形成持锁与无锁写入混合状态，破坏原子性保证。多个现有测试通过提取旧页面处理器文本进行回归，接线时必须把测试迁移到实际新处理器，而不能删除/弱化断言以换取绿色 CI。

下一工程里程碑：在一个原子代码变更中将 **四类写入全部改用 `createNormalPageRuntime`，将生命周期交给 `attachNormalPageLifecycle`**，更新相应真实页面专项测试；先完成异步初始化/交互冻结、存档导出、状态反馈、键盘与拖拽、手机页面隐藏恢复的闭环。页面接线后仍需真实浏览器跨标签与移动端验收，不能直接宣称 RC。

## 执行门禁与发行边界

- 所有研发提交标题以 `[CF-Pages-Skip]` 开头，确保不会因普通提交误触发 Pages 构建；但 Cloudflare 控制台预览禁用状态未独立核实，不能仅靠标题认定没有部署。
- 运行相关 Node 专项测试和 `bash scripts/security-check.sh`；必须核对**新 SHA** 对应的全仓库回归、静态安全/部署隔离、完整 Git 历史密钥扫描三项 GitHub Actions。
- 不更改 `main`、正式导航、部署白名单、GitHub Pages、Cloudflare、Edge 或在线 Supabase 数据；不修改剧情模式分支或其他自动化任务；PR #58/#59 均保持 Open/Draft。
