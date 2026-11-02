# P28 · 剧情与工作台跨存档共用 Web Lock（未发布）

## 风险与修复
此前剧情对白使用 `toolbox.merge-isle.story.write.<story-key>`，经营工作台使用 `toolbox.merge-isle.story.write.<workshop-key>`。P26/P27 在各自写入锁内核对另一份存档，但不同锁名允许两份存档在前置条件检查和写入之间交错，造成因果条件竞态。

本轮将两个剧情存档键的写入请求统一到**原对白锁名**；对白初始化、完成、重置与工作台正常经营、修建、重置均已通过相同的 `runStoryWriteWithLock` 入口，因此参与该协议的同源标签可顺序执行两份存档的检查与写入。保留对两个剧情键的白名单、独占模式、原文 CAS、修订号校验与锁异常拒绝策略。普通模式不参与、不改动。

## 验证
新增 `tests/merge-story-cross-save-lock-p28.test.mjs`，分别以对白和工作台先占锁，确定性验证另一端不会在锁释放前进入；覆盖锁请求失败及普通模式键拒绝。同步修订 P23 的测试阻塞器锁名，避免旧名称导致测试不再真正阻塞重置。

## 剩余风险
这**不是 localStorage 的跨键原子事务**：Web Locks 只保护支持该 API、同源且运行新版协议的页面。旧标签、无 Web Locks 的 Safari/微信 WebView、浏览器终止或异常脚本仍可能绕过锁；两个键的多步操作仍没有原子提交/回滚能力。没有真机验证，不能将 CI 视为 iPhone 兼容或发行验收。

发行边界：PR #59 保持 Draft，不合并或修改 main，不发布 Pages/Cloudflare/Edge，不更改导航或部署白名单，不执行线上 SQL/迁移、不接触生产数据、不加入作弊后门。
