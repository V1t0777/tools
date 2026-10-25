# 《云屿百物铺》P44 · 剧情工作台精确返回上下文（仅独立研发分支）

## 解决的问题
P43 可从对白卡片直达五类真实经营目标，但工作台返回剧情时仍落在默认主线列表（仓库仅回到「人物支线」标签）。长篇剧情中玩家需再次查找原先被经营目标拦住的章节。

## 本轮实现
- 五个工作台目标分别提供静态、可复制的返回链接：街坊委托→《第一杯热茶》，仓库收纳→岚叔《工具有自己的位置》，花园修复→《两个人的下午茶》，港湾修缮→《海雾里的灯》，门面修整→《开张庆典》。保留页面顶部与底部的通用返回入口。
- 剧情页面的 `#story-<core-id>` 片段仅接受首卷真实的 main/side 条目；自动切换对应标签，并在条目存在、已解锁时滚动定位与键盘焦点提示。未解锁时不强制打开对白、不绕过经营或主线门禁。
- 旧版 `#side` / `#incident` 继续可用。未知、恶意或 DLC 同名片段不参与 DOM 选择器拼接，默认回到主线列表。
- 不使用 localStorage/sessionStorage，不修改故事进度、存档结构、订单、资源、建筑或随机事件。原生 HTML 锚点在脚本未加载时仍可访问剧情页；没有依赖新的外部库。
- 保留移动端 44px 触控区、安全区、深色主题与减少动态效果偏好；实际 iPhone VoiceOver/Safari 的焦点体验仍需真机验收。

## 同步与验证
安全纳入上游 Draft PR #58 的 P2.59 与 P2.60a：普通模式 bfcache 恢复门禁及持锁模块边界专项回归（仅采用上游原始 blob，剧情分支原先未改这些路径）。此轮无生产部署变更。

专项：`node --test tests/merge-story-return-context-p44.test.mjs tests/merge-story-workshop-deeplink-p43.test.mjs`。
全仓库及安全门禁：`node --test tests/*.test.mjs scripts/*.test.cjs`、`bash scripts/security-check.sh`、完整 Git 历史密钥扫描。**以最终提交 SHA 的 Actions 结果为准**，不可用测试数量或 CI 代替真机体验。

PR #59 保持 Open/Draft。不得合并 main、发布 Pages/Cloudflare/Edge、修改正式导航或部署白名单、操作线上 Supabase 或添加作弊后门。未完成真实双标签/真机验证前不提出 RC。
