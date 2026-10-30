# P154 · 一次性事件跨标签与 BFCache 安全回归（2026-10-30，未发布）

## 本轮范围
承接 P153「潮水送来的木箱」当日回看修复，不新增章节、事件、奖励或经济系统。新增 `tests/merge-story-oneoff-concurrency-p154.test.mjs`，验证同一天已固定的一次性线索被另一标签页完成时，当前标签不能把对方的剧情完成误判为「仅写入了相同日常固定标记」。

## 可复现验证
1. 两标签以相同的已固定木箱事件存档开始：B 完成事件后，A 的旧选择写入必须被原始字节比较拒绝；普通经营存档保持不变。
2. A 从 BFCache / 后台恢复：旧原始字节快照判定 `WRITE_CONFLICT`，只允许相同日常固定标记的自动协调不能吞掉真正的剧情完成；重新读取 B 的存档后，同一天可只读回看已完成木箱。
3. A 收到 B 的 `StorageEvent`：该事件属于剧情存档变更，不能作为可被动接纳的「仅固定今日事件」；不自动重抽或写入。
4. 日期跨越午夜：昨日木箱对白不得继续提交，次日排除已完成的一次性线索；既有完成记录与存档不变。
5. 检查剧情页面的事件提交、跨标签冲突和 pagehide 保护仍接入相应守卫。

专项命令：`node --test tests/merge-story-oneoff-concurrency-p154.test.mjs`。完整 Node 回归、`bash scripts/security-check.sh`、静态部署隔离和完整 Git 历史扫描均以最终提交 SHA 对应的 GitHub Actions 实际结果为准；若未获得完整 CI 证据，不标记通过。

## 剩余风险与发行边界
本轮仅增加回归覆盖，没有修改生产运行时、普通经营模式、存档格式或数值。纯函数及 Node 模拟不能证明真实 Safari/微信 WebView 的 BFCache 事件顺序、StorageEvent 交付、Blob 下载落盘。真实 iPhone Safari、微信 WebView、Windows 离线与损坏存档下载验收仍为 P0；普通模式触控偶发超时、跨标签非原子读写及 PR #58 安全前向同步仍为 P1。

PR #59 必须继续 Open/Draft；不修改 main、正式入口、部署白名单，不部署 Pages/Cloudflare/Edge，不运行线上 Supabase SQL/迁移或接触生产数据。提交必须保留 `[CF-Pages-Skip]` 前缀；跳过标记不等于独立核验 Cloudflare 后台部署已关闭。
