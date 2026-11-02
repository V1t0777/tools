# P150｜剧情工作台设备时钟异常的主动提示（2026-10-30）

## 问题与范围

此前 P148/P149 的时间回拨诊断只有在玩家尝试失败的经营操作后才会出现在 `board-notice`。移动端冷启动或 BFCache 返回时，玩家可能先看到体力为零或工坊冷却中，却不知道本机时钟与存档时间冲突。

本轮只修改剧情工作台 `merge/story/workshop.mjs` 的**只读渲染**：每次 render 通过既有 `describeStoryWorkshopStall` 检测 `CLOCK_BEHIND_ENERGY` 与 `CLOCK_BEHIND_COOLDOWN`，主动展示校时、保留原始存档的警示；没有异常时不伪造时钟错误。只有当前提示确实仍是本页上一次写入的时钟警示，才会在异常消失后替换它，避免覆盖其他写入冲突或经营反馈。

## 回归证据与执行

在 `tests/merge-story-warehouse-upgrade-p145.test.mjs` 追加 3 项 DOM 级专项：体力计时未来值在冷启动/BFCache 恢复时立即告警；超出正常上限的工坊冷却同样告警且不消耗重启卡；正常冷却不误报。断言剧情工作台原始字节无变化、写入次数为零，普通模式及剧情对白存档不变。

运行 `node --test tests/merge-story-warehouse-upgrade-p145.test.mjs` 及仓库全量 Node 测试；按 `AGENTS.md` 执行 `bash scripts/security-check.sh`，并核对完整 Git 历史密钥扫描及最终新 SHA 的 GitHub Actions 结果。**本文件不预先宣称 CI 通过；以 GitHub 实际完成的工作流为准。**

## 仍需验收

- 真正的 iPhone Safari、微信 WebView、Windows 离线环境，以及异常存档下载实际落盘均未验收；DOM 注入与 Chromium 模拟不等于真机。
- 系统时钟异常时**不会**自动补发体力、修改冷却、消费道具、覆盖存档或清理浏览器数据。部分极端满盘场景仍优先显示棋盘解堵提示；不能据此推断所有时钟错误均已被检测。
- `localStorage` 跨标签读写并非原子事务，Web Locks 只保护主动参与的同源标签。普通模式偶发触控超时及与 PR #58 的安全同步仍列 P1。

本轮仅修改独立剧情开发分支，PR #59 继续 Open/Draft；不合并 main、不修改正式入口/部署白名单、不发布 Pages/Cloudflare/Edge、不执行线上 Supabase SQL/迁移。11 月 10 日仅为争取提交发行候选终审的目标，正式发布需另行明确授权。
