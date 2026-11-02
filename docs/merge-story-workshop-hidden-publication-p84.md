# P84 · 剧情工作台隐藏页面写入结果发布保护（未发布）

## 问题与修复
- 移动浏览器可能先将 `document.visibilityState` 置为 `hidden`，稍后才派发 `visibilitychange` 或 `pagehide`。在该短窗口内，原有存档 epoch 尚未变化，剧情工作台的 Web Lock 结果发布检查可能误把刚提交的操作显示为稳定成功。
- `verifyStoryWorkshopPublication` 增加只读 `suspended` 条件，隐藏或 BFCache 暂停时一律拒绝发布成功提示；先拒绝，再读取存档。现有 epoch、原始字节和建筑前置剧情检查保持不变。
- 剧情工作台普通操作及重置的**锁释放后**和**渲染后**共四个检查点均传入实时 `pageSuspended()`。已经写入的操作不回滚、不自动重放；显示结果不确定，要求重新打开页面核对。普通模式与剧情对白存档不变。

## 自动化验证
```sh
node --test tests/merge-story-workshop-publication-p62.test.mjs tests/merge-story-workshop-lifecycle-p70.test.mjs
node --test tests/*.test.mjs scripts/*.test.cjs
bash scripts/security-check.sh
```
- P62 专项验证隐藏状态下不读取存档、不发布成功，正常可见路径保持通过。
- P70 真实工作台入口模块故障注入：Web Lock 回调完成写入后、页面事件尚未派发时，模拟 `visibilityState='hidden'`；页面不宣称重置成功，不自动重试，普通经营和对白存档不受影响。
- 以最终提交 SHA 的 GitHub Actions 全量回归、静态安全/部署隔离、完整历史密钥扫描三门禁为准；未运行的本机检查不得写成已通过。

## 风险与发行边界
- Node 注入不能替代 iPhone Safari / 微信 WebView 真机的原生确认、后台/BFCache、跨标签写入和损坏存档下载落盘测试；`localStorage` 不是跨标签原子事务。
- 11/10 仅是有条件交付可供终审的离线 Web 候选版目标。PR #58/#59 保持 Draft；禁止修改 main/正式入口/部署白名单、发布 Pages/Cloudflare/Edge、执行线上 Supabase SQL/迁移或接触生产数据。提交须使用 `[CF-Pages-Skip]`。
