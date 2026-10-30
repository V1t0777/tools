# 云屿 V3.1 P2.65cn｜移动模拟重置—再经营—再导出闭环

日期：2026-10-30（北京时间）。范围：仅普通模式 Draft PR #58 的 Chromium P0 回归，不修改正式运行时。

## 本轮验证目标

在既有 320px Chromium CDP 移动模拟双标签/BFCache 场景（A 已采纳 B 的真实 Web Locks 写入）之后，继续以模拟原生触控执行：

1. 触控重置并拒绝确认：存档原始字节保持不变，恢复前备份及剧情命名空间不变。
2. 再次触控重置并明确确认：经正式页面运行时和独占锁提交新的普通模式初始存档；核对 revision、体力、金币、经验及备份隔离。
3. 在同一页面触控生产、等待已保存状态，随后再次触控导出 JSON；实际读取 Chromium 下载文件，要求与重置后最新存档字节一致。
4. 复核整个页面无横向溢出；测试失败不得靠固定延时、重试点击或跳过断言掩盖。

## 范围及发行风险

- 只增加 `tests/merge-browser-mobile-normal-p0.test.mjs` 的同主题组合验证和本文档；不改经济数值、存档格式、剧情文件、导航或部署配置。
- 使用真实 Chromium/CDP 的移动模拟触控、Web Locks、localStorage、文件下载；不是 iOS Safari/微信 WebView 真机结果。
- 真机仍需核实文件选择、下载落盘、BFCache/后台恢复、触控滚动及重置确认；云端存档不属于本次离线首发。
- PR #58/#59 保持 Open/Draft；禁止合并 main、发布 Pages/Cloudflare/Edge、执行线上 Supabase SQL/迁移、强推或制作作弊入口。
- 以新提交 SHA 对应的全仓库 Node、`scripts/security-check.sh`/静态部署隔离、完整历史密钥扫描结果作为门禁；未通过不得宣称完成。
