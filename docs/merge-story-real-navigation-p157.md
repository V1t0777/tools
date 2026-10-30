# P157｜真实 Chromium 历史导航恢复专项（2026-10-30，未发布）

## 目标与范围

在 P155–P156 真实双标签与合成生命周期事件回归基础上，增加 **浏览器真实文档导航离开与历史返回**，检查一次性事件《潮水送来的木箱》的存档一致性。仅修改剧情专项测试，不修改游戏逻辑、经济参数、存档协议或普通模式。

## 新增两段真实导航场景

1. **原始字节不变**：已完成并固定当日事件后，从剧情页导航至同源静态资源，再通过 Chromium 的 `Page.getNavigationHistory` / `Page.navigateToHistoryEntry` 返回；确认事件可只读回看、存档原字节不变、对白不会作为旧操作保留。
2. **离开期间另一标签改写**：剧情页打开对白后真实导航离开，另一真实标签把同 revision 的有效剧情存档改为不同字节，再通过历史返回。允许浏览器复用 BFCache 后按冲突保护阻断，或重新加载后读取最新存档；**不允许旧对白继续提交、不允许覆盖新存档**。普通模式哨兵与独立剧情工作台存档保持不变。

以上测试继续使用本地 HTTP 服务器、无头真实 Chromium、CDP、localStorage 和浏览器历史导航。复用 `tests/merge-story-browser-oneoff-tabs-p155.test.mjs` 的同一测试用例，因此 Node 测试条目数不一定增加。

## 边界与验收

- **不保证 BFCache 命中**：本地测试服务器返回 `Cache-Control: no-store`，浏览器可能回退为全新文档加载；测试同时接受安全的 BFCache 冲突阻断和新文档正确读取。不得把本测试写成“真实 BFCache 命中”或 Safari 验收。
- 浏览器测试不覆盖 iPhone Safari、微信 WebView、Windows 实机、系统下载落盘、离线安装与长期后台冻结；这些仍是发行 P0 阻塞。
- 普通模式 Chromium 触控偶发超时与 localStorage 非原子跨标签竞态仍保留 P1；本测试不是多标签事务证明。
- 只允许非 main 剧情开发分支，提交前缀必须为 `[CF-Pages-Skip]`；保持 PR #59 Draft，禁止发布 Pages/Cloudflare/Edge、改部署白名单或执行生产 Supabase SQL。

## 核验

专项：`node --test tests/merge-story-browser-oneoff-tabs-p155.test.mjs`。

全量：`node --test tests/*.test.mjs`；`bash scripts/security-check.sh`；完整 Git 历史密钥扫描。三项最终 CI 状态必须由 **最终提交 SHA** 独立核实，不能以旧 SHA 或单次本地断言代替。

后续：10/31–11/02 聚焦首卷主支线因果、手机优先交互及实际导航/后台恢复风险；11/03–11/05 再与 PR #58 进行文件重叠和共同祖先核验后安全同步。不得为追进度直接合并或强推。
