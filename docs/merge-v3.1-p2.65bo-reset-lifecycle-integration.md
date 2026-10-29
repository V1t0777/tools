# V3.1 P2.65bo｜重置与真实生命周期桥接的组合门禁（未发布）

## 目标与范围
在 PR #58 的普通经营离线模式中，验证用户确认重置后，Web Lock 等待、跨标签存档变更、Safari/BFCache 生命周期与恢复前备份预留之间的组合时序。此轮只增加专项测试和中文证据说明；不改变经济数值、运行时、存档格式、剧情源文件或部署配置。

## 四项组合断言
1. 锁等待时先后发生 hidden、pagehide、隐藏态 pageshow 和恢复可见：旧确认失效；不写存档或备份，页面不得恢复为可写状态。
2. 锁等待时其他标签改写原始存档：最终锁内基线核验必须拒绝重置，不能回滚新进度或占用恢复前备份。
3. pagehide 后、重置尚未完成时收到 persisted pageshow/focus：BFCache 事件不能为旧重置重新授权。
4. 备份预留写入期间 pagehide，随后 pageshow：允许保留已写入的原始字节备份，但绝不能继续覆盖当前存档。

测试直接调用 `createNormalPageRuntime`、`attachNormalPageLifecycle` 和既有重置事务；只对浏览器事件、Web Locks 授予时序与 Storage 做确定性替身。断言普通模式原始字节、独立恢复前备份及剧情模式存档隔离。它不等于真实 Chromium 双标签竞争或 iPhone/微信 WebView 真机验收。

## 验证门禁与剩余风险
新增 `tests/merge-normal-reset-lifecycle-integration.test.mjs`，应随全仓库 Node 回归运行。任何新 HEAD 必须同时通过 Node、`bash scripts/security-check.sh`/部署隔离、完整 Git 历史密钥扫描三项 CI 才可记为自动化通过。跨标签 localStorage 并非对不合作标签的硬件级原子事务；真实 iPhone Safari、微信 WebView 原生文件选择/下载落盘、后台恢复与剧情首卷最终集成仍为发行阻塞。Cloudflare 后台实际部署状态无法独立验证时必须保留风险。

**硬边界：** PR #58/#59 保持 Open/Draft；不合并或写入 main，不修改正式导航、部署白名单，不部署 Pages/Cloudflare/Edge，不操作线上 Supabase，不做作弊后门。候选版需用户审阅；发布须另行明确授权。
