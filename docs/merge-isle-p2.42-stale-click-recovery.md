# 《云屿百物铺》V3 · P2.42 取消过期拖拽后恢复下一次真实点击（未发布）

## 问题
P2.40–P2.41 在跨标签存档同步或冲突时取消旧拖拽，并设置 `ignoreNextClick` 来吞掉浏览器可能产生的延迟 click。但若取消后没有迟到的 click，标志会一直保留，导致玩家下一次正常点击被错误忽略。键盘 Enter/Space 触发的 click 也可能被误吞。

## 单一增量
仅修改普通模式棋盘的 click/pointerdown 接线：
- 仍吞掉取消拖拽后、未出现新 pointerdown 的首个合成 click。
- 新的主按钮 pointerdown 视为新手势，先解除旧 click 抑制；右键不解除。
- `event.detail === 0` 的键盘激活不属于拖拽合成 click，不予吞掉，也不清除仍需防护的旧 pointer click 标志。
- 不改动存档、体力、金币、订单、重置、跨标签冲突判定或部署边界。

## 验证与局限
`tests/merge-storage-event-policy.test.mjs` 使用 Node VM 执行实际棋盘 click/pointerdown 回调，覆盖迟到 click、首次新触控、右键及键盘激活。此验证不等于真实双标签浏览器、iPhone Safari、微信 WebView 验收。极端浏览器事件乱序（旧 click 在新 pointerdown 后才抵达）仍需要实机检查；同步 localStorage 写入竞争尚未解决。

本轮不修改 main、不合并、不发布、不改正式导航或部署白名单、不操作线上 Supabase、不制作美术或作弊后门。PR #58/#59 继续 Open/Draft；只有当前 HEAD 对应全仓库回归、静态安全与部署隔离、完整 Git 历史密钥扫描全部成功，才标记完成。
