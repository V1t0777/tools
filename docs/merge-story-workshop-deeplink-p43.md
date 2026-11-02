# 《云屿百物铺》P43 · 剧情目标直达工作台（未发布）

## 玩家体验缺口
P42 让岚叔支线实际依赖仓库收纳，也让剧情卡显示进度。但点击“阅读故事”再“前往剧情工作台”总是落在工作台顶部；在 iPhone 小屏上，玩家需要反复滑过 7×8 棋盘寻找仓库、花园、港湾或庆典建设入口，且从仓库返回后默认回到主线，容易丢失人物支线位置。

## 本轮小范围实现
- `merge/story/workshop-gate.mjs` 在五个**真实**经营目标的既有定义上登记稳定锚点，新增纯函数 `storyWorkshopGoalHref`；未知或 DLC 节点仅返回无锚点工作台链接，避免伪造目标。
- `merge/story/ui.mjs`：未完成的目标卡新增 44px 触控直达入口；对白弹窗内同样定位到对应经营区域。异常工作台存档使用“核对”而非“完成”的文案。只读取已有目标状态，不改变存档。
- `merge/story-workshop.html`：订单、仓库、花园、港湾、门面建设各添加可聚焦、原生 fragment 定位区域；仓库提供返回 `story.html#side` 的人物支线入口。
- `merge/story/ui.mjs` 首次进入时识别受限 `#side` / `#incident` 标签，不写入本地存储，不增加路由框架。
- `merge/story/story.css` 为直达链接保留 44px 最小触控高度、目标高亮及滚动边距，沿用暗色和减少动画媒体查询。
- `tests/merge-story-workshop-deeplink-p43.test.mjs` 覆盖五条目标路径、未知 DLC 降级、弹窗/卡片链接一致性、支线返回、移动端约束。

## 验证与限制
应运行 `node --test tests/merge-story-workshop-deeplink-p43.test.mjs`、全仓库 Node 回归、`bash scripts/security-check.sh`、完整 Git 历史密钥扫描。最终以本提交 SHA 的 CI 状态为准。
原生 hash 锚点无须额外 JS；但 Safari BFCache、浏览器底栏、安全区、实际滚动落点与 VoiceOver 聚焦仍需真机验收。当前改动不是普通模式的跨标签原子写入修复，不能宣布 RC。

不得合并 main、发布 GitHub Pages/Cloudflare/Edge、改正式导航或部署白名单、运行线上 Supabase SQL/迁移、接触生产数据或制作作弊后门。PR #58/#59 均保持 Draft。
