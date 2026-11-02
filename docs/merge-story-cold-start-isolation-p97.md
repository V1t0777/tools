# 云屿剧情 P97｜普通模式冷启动与剧情存档隔离（未发布）

## 本轮工程边界
- 在双方共同祖先和五个上游文件 Blob SHA 一致的前提下，前向同步 PR #58 P2.65af 的首次后台加载 / BFCache 冷启动修复。仅改普通模式既有文件和新增剧情侧测试，不修改剧情或经营数值。
- 增加三个跨模式真实模块回归：后台未启动时另一标签完成剧情并保存、首次 pagehide 后必须等待真实 pageshow 且可见才启动、剧情与工作台 UTF-16 异常证据在普通模式冷启动后仍逐字保留。
- 测试直接组合普通模式运行时及生命周期桥、独立剧情/工作台持久化模块，验证普通启动不会替换剧情命名空间；不伪造真实 Safari/WebView 结果。

## 验证和风险
- 专项：`node --test tests/merge-story-cold-start-isolation-p97.test.mjs`
- 全量：`node --test tests/*.test.mjs`；静态：`bash scripts/security-check.sh`；全历史密钥扫描和三项 Actions 门禁以新 SHA 为准。
- 浏览器 localStorage 不是跨标签原子事务；模拟 DOM 事件不等于 iPhone Safari、微信 WebView 的后台恢复和下载落盘验收。
- 保留 PR #58/#59 Draft/Open、[CF-Pages-Skip]、部署隔离和所有正式发布限制；11 月 10 日仅争取提交候选供用户终审，未获单独许可不发布。
