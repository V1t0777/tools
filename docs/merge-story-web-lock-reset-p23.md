# P23 · 剧情工作台重置加入 Web Locks（Draft，禁止发布）

## 本轮修复
P22 的剧情工作台正常操作已经使用 Web Locks，但**用户确认重置**仍直接写入本地存档。旧路径可能与另一个标签页的正常经营写入交错，导致重置覆盖刚刚保存的经营进度。本轮将工作台重置纳入与普通操作完全相同的存档键独占锁。

- `merge/story/workshop-reset.mjs`：在同名锁回调内读取当前存档、核对 `expectedRaw`、检查页面仍有效，再通过既有 `writeStoryWorkshop(...,confirmedReset:true)` 执行原文比较和写前二次校验。
- `merge/story/workshop.mjs`：保留异常原始记录备份提醒及**两次明确确认**；确认之后才请求锁。等待期间 `saving=true` 禁用工作台交互。跨标签存储事件或页面恢复核对失败时递增 `storageEpoch`，防止排队中的重置在过期页面继续写入。
- 锁存在但拒绝/异常时 **fail closed**，绝不降级重试；浏览器无 Web Locks 时仅使用既有 best-effort CAS。
- 仅改剧情工作台重置；剧情对白正常保存、剧情对白重置、首次启动自动初始化仍未加入锁。未新增任何存档键、经济奖励、线上接口或部署变更。

## 可复现验证
`tests/merge-story-web-lock-reset-p23.test.mjs`：正常写入先于重置、重置先于正常写入、异常存档重置、普通与对白命名空间隔离、旧快照拒绝、锁请求失败、等待时失效、无 Web Locks 回退，以及 UI 确认和禁用状态静态契约。

## 尚存风险
Web Locks 只协调支持该 API、同源、同锁名的参与者；老页面或其他直接写入仍可能竞争，不能声称跨设备或浏览器的真正原子事务。iPhone Safari、微信 WebView、BFCache、后台挂起、文件导出与触控交互仍未真机验收。

## 发行边界
PR #59 保持 Draft；不得合并或写入 main，不发布 Pages/Cloudflare/Edge，不修改正式导航或部署白名单，不执行线上 Supabase SQL/迁移，不接触生产数据，不制作作弊后门。
