# 《云屿百物铺》P65 · 普通经营持锁入口与剧情双模式兼容（仅 Draft）

## 背景与本轮改动

上游 P2.64f 将普通经营实际页面入口由旧同步 CAS 的 `main.mjs` 切换到统一 Web Locks 的 `main-locked.mjs`。剧情分支独立加入的 `merge/index.html`「进入剧情体验」链接不在上游，需要在双父合并时同时保留，不能直接覆盖整个 HTML。

- 合并上游提交 `386938942bb106f33f3be57b1c663be76f282194` 的普通模式持锁入口、整理提示预检和活跃入口 DOM 回归，原始上游提交保留为第二父提交；没有改变正常模式金币、体力或建筑数值。
- `merge/index.html` 保留 `./story.html` 剧情入口，唯一 module script 改为 `./main-locked.mjs`，不同时加载旧 `main.mjs`。
- 修订 `tests/merge-story-ui-contract.test.mjs`：从 HTML 解析实际普通模式 module 入口再检查剧情隔离，避免继续测试已不被页面加载的旧同步文件。
- 剧情对白与剧情工作台仍分别使用既有独立存档；普通模式持锁入口不引入剧情 UI 模块。

## 验证与发行边界

- 应运行 `node --test tests/merge-story-ui-contract.test.mjs tests/merge-locked-page-dom.test.mjs tests/merge-locked-page-candidate.test.mjs tests/merge-normal-writer-boundary.test.mjs`，全仓库 `node --test tests/*.test.mjs` 及 `bash scripts/security-check.sh`；以最终 SHA 的 GitHub Actions 全部门禁结论为准。
- 本轮只改研发分支的普通模式页面入口，**不是正式工具箱导航、发布白名单或线上部署入口变更**。
- Web Locks 不可用、跨标签并发、异常存档、iPhone Safari/微信 WebView 的真实手势和后台恢复仍须在真机验收；CI/DOM 模拟不能代替真机。
- PR #58/#59 保持 Draft；不合并 main、不发布 Pages/Cloudflare/Edge、不操作线上 Supabase、不添加作弊后门。
