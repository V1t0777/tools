# 《云屿百物铺》剧情 P68 · 重置结果不确定时的提示与 DOM 故障注入（仅 Draft）

## 本轮发现

剧情工作台 P67 已在交单、建造、页面恢复及跨标签存档冲突时撤回旧成功提示，但**重置工作台**存在遗漏：Web Lock 被拒绝、精确原文 CAS 失败、锁释放后被其他标签覆盖或渲染时发生覆盖，可能留下上一次生产/交单的成功提示，甚至先写警告再渲染。用户无法判断重置是否已经生效。

## 实际修复

- 重置失败、锁后首次复核失败、渲染后再次复核失败，统一先渲染保护状态，再通过 `board-notice` 的 `role=status` / `aria-live=polite` 发布不确定提示；渲染后失败明确撤回重置成功提示。
- 浏览器存储不可用时，即使旧点击事件已排队，重置处理函数也拒绝继续；保留原有用户二次确认、共享 Web Lock、精确原文 CAS、revision 单调性及双重复核。
- 不自动重试、不回滚、不重新生成订单、不清除其他模式进度；**失败不代表未写入**，需重新打开页面核对实际状态。

## 可验证证据

`tests/merge-story-workshop-dom-p68.test.mjs` 使用最小事件型 DOM 注入真实 `workshop.mjs`，覆盖 Web Lock 拒绝、锁后外部覆盖、同步渲染覆盖、正常重置和禁用按钮防绕过。此模拟只检验 JavaScript 交互链路，**不等于 iPhone Safari、微信 WebView 或 VoiceOver 真机测试**。

回归命令：`node --test tests/merge-story-workshop-dom-p68.test.mjs tests/merge-story-workshop-reset-publication-p63.test.mjs tests/merge-story-conflict-feedback-p67.test.mjs`；全仓库 `node --test tests/*.test.mjs`；`bash scripts/security-check.sh`。最终以对应提交 SHA 的 CI 三项状态为准。

## 强制边界

只改剧情独立分支的工作台、测试与研发文档。PR #58/#59 保持 Draft；不得合并 main、修改正式导航/部署白名单、部署 Pages/Cloudflare/Edge、执行生产 SQL/迁移或制作作弊后门。所有推送提交保留 `[CF-Pages-Skip]` 前缀。