# P30 · 日历校验及动态岛屿事件的真实经营回声（未发布）

## 当前缺口
原 `dailyStoryIncident` 只以正则检验 `YYYY-MM-DD` 外观，可将 2 月 30 日等非法日期输入确定性哈希；事件对白无论玩家是否修缮花园/港湾/门面或完成街坊委托，表现完全相同。现有六条事件本身已按主线 `requires` 解锁，本轮不修改解锁、经济或存档格式。

## 实际变更
1. 在 `merge/story/runtime.mjs` 增加不依赖本地时区的**真实公历日期校验**：年月范围、每月天数、闰年与整百年例外。保持原有哈希及候选顺序，合法日期的事件选取结果不变。
2. 新增 `merge/story/incident-context.mjs` 只读函数 `incidentWorkshopEcho`：根据原 V3 经营状态的真实 `progress.orders` 和 `buildings.garden/harbor/storefront`，为六个已有日常事件各选择一条完整中文后续对白。包含：修整门面的猫、花园阵雨、已接委托的来客、雾中港湾、烘焙失手以及登记不明木箱。即使建筑已修缮仍不允许浓雾出航；箱子不强行打开，为未来 DLC 留空间。
3. `merge/story/ui.mjs` 在阅读今日事件的当下只读 `readStoryWorkshop`，且**仅当存档真实存在、未损坏、引擎校验通过**时附加工作台回声；空档或坏档显示原始通用事件。沿用 `textContent`，不拼接 HTML。
4. 保持 `CORE_STORY_PACK`、`STORY_SAVE_KEY`、工作台经济、事件每日哈希、所有主支线和已读记录**完全不变**；回声不发放物品、不消耗体力、不记录重复奖励。已读事件允许回看；没有假称每日再次完成可获取奖励。

## 可靠性与可扩展性
- 此回声只针对首卷六个已存在的 `incident` ID；未知 DLC 事件返回空，不依赖或修改其他独立故事包。
- 当日若主线新解锁了事件，**可选事件集合仍有机会改变**，因而今日展示的事件可能随剧情推进而变化。本轮保持旧算法以免破坏旧存档或事件历史；这是后续冻结每日选择需解决的已知问题。
- `localDay()` 仍取设备本地日历，客户端修改设备日期仍可影响选择，但无法因此获得资源或跳过主线。缺乏服务端权威时间不应声称抵抗改时钟。
- 未来如增加领取奖赏或持久化事件日期，必须先升级版本化 schema、幂等与跨标签锁协议，不可直接复用当前已读列表制造奖励。
- iPhone Safari / 微信 WebView 的实际触控、后台恢复、系统日期变更与动态文本布局尚未完成真机验收。

## 验证
`node --test tests/merge-story-incident-context-p30.test.mjs tests/merge-story-runtime.test.mjs`，`node --test tests/*.test.mjs`，`bash scripts/security-check.sh`，完整历史密钥扫描；以最终 SHA GitHub Actions 结果为准，CI 不等于 iPhone 实机。

**发行边界不变：** 仅写入剧情独立分支并保持 Draft；不碰 main、正式导航与部署白名单、线上 Supabase SQL、Cloudflare/Pages/Edge 发布与生产数据。
