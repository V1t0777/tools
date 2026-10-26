# 《云屿百物铺》V3.1 · P2.64f 普通模式页面入口原子切换（仅 Draft 研发分支）

## 研发目标与范围

此前 P2.61w–P2.64e 已完成普通模式四类持锁事务、运行时协调、生命周期、移动端手势及 DOM 候选验证，但 `merge/index.html` 仍指向旧的同步 CAS 页面。继续只修候选而不让页面入口使用它，会让测试结果和真实加载的代码分离。本轮集中完成一次 **独立研发分支内的页面脚本入口切换**，并让 DOM 测试从 HTML 解析真实入口。此变更不涉及正式小游戏导航、部署白名单或发布授权。

## 同一主题的四项闭环变更

1. **唯一入口切换**：`merge/index.html` 仅把 `./main.mjs` 替换为 `./main-locked.mjs`；旧文件保留供历史测试和差异审查，不在 HTML 中加载，杜绝同一页面同时使用同步 CAS 与 Web Locks。
2. **只读整理提示预检**：候选页面的整理提示按钮在计算/切换高亮前，也检查真实原始存档是否被其他标签更新。检测到新进度则只读采用并要求重新请求，不会把旧棋盘提示误展示到新棋盘上。
3. **活跃入口 DOM 回归**：`tests/merge-locked-page-dom.test.mjs` 不再硬编码候选模块，改为解析 `merge/index.html` 唯一 module script 后实际动态导入。此前启动、棋盘、补给、确认重置、移动端拖拽、BFCache、跨标签等用例因此自动覆盖**当前研发分支实际页面入口**；新增整理提示延迟事件回归。
4. **迁移结构门禁**：`tests/merge-normal-writer-boundary.test.mjs` 从旧同步页面断言迁移为实际入口/四类事务/统一锁检查；`tests/merge-locked-page-candidate.test.mjs` 改为断言 HTML 只加载持锁页面。旧同步代码仍保留用于历史专项回归，但不能再将它的测试结果冒称为新页面测试。

## 必须保持的安全不变量

- 所有普通模式写入只能经 `createNormalPageRuntime` 的启动、玩家动作、计时器和用户确认重置；不能有同步 CAS 写入与 Web Locks 混用。
- 锁不可用、异常原始字节、重置备份未读回、跨标签冲突、在途手势及 BFCache 恢复时一律保守阻断，不自动覆盖原始存档。
- 只读导出当前原始存档和异常重置前备份可在写入阻断时继续尝试；剧情模式存档键不得写入。
- 旧 `merge/main.mjs` 的历史源码片段测试仍可运行，但其安全断言仅适用于**未被加载的旧代码**。以活跃入口 DOM 测试及新的结构门禁证明当前页面行为；后续再逐项淘汰或迁移旧源码切片测试，不可直接删除以获得绿灯。
- 本轮无美术、经济参数、云端接口、正式导航、部署白名单或线上数据库改动。

## 验证要求与尚未完成的事项

优先运行 `node --test tests/merge-locked-page-dom.test.mjs tests/merge-locked-page-candidate.test.mjs tests/merge-normal-writer-boundary.test.mjs` 和 `bash scripts/security-check.sh`，再以同一 HEAD 的 GitHub Actions 三项（全仓库 Node 回归、静态安全/部署隔离、完整历史密钥扫描）均成功作为研发分支的自动化门禁。若本地无法克隆，仅能如实报告 GitHub Actions 的结果，不能声称本地测试完成。

**注意：这是 Draft 分支页面入口切换，不是正式网站上线。** 即使 CI 全绿，仍需真实双标签浏览器、iPhone Safari/微信 WebView、下载落盘核实和 Cloudflare 部署记录独立核查；没有真实设备/云端联调不能进入 RC 或发布。

## 部署与并行研发隔离

PR #58、PR #59 保持 Open/Draft。仅允许在 `feat/merge-isle-p0-p1` 的预期 HEAD 上原子提交，标题以 `[CF-Pages-Skip]` 开头；不写 main、不合并、不发布 GitHub Pages/Cloudflare/Edge、不修改正式导航或部署白名单、不操作线上 Supabase SQL/迁移/数据、不新增自动化或密钥。剧情 PR #59 以普通分支为 base，可能因普通分支前进而更新比较基线，但不得覆盖剧情分支 HEAD。
