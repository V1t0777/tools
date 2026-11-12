# 《云屿百物铺》V3 · P2.61d 移动端焦点恢复存档只读复核（未发布）

## 背景
P2.58 的 `visibilitychange` 和 P2.59 的 BFCache `pageshow.persisted` 已能在常见页面恢复路径重新核对原始存档字节。但部分移动端 WebView 或浏览器切换窗口后可能仅派发 `focus`，不保证产生新的可见性变化或 BFCache 事件。此时若跨标签存档事件延迟或丢失，旧页面可能仍持过期的 `persistedRaw`。

## 本轮单一增量
仅在普通模式 `merge/main.mjs` 监听 `window.focus`：页面可见时复用既有 `revalidateResumedSave()`，只读取原始存档并比较已确认字节。发现变更、移除或损坏后保持原始基线、取消过期拖拽/选择并阻断后续写入；已阻断页面不自动解除。隐藏状态不额外读取。焦点事件绝不执行写回、迁移、重置或云端操作。

## 专项回归
`node --test tests/merge-focus-resume-guard.test.mjs`：正常焦点恢复不改动选择或存档、远端修改时取消旧拖拽并阻断、隐藏页面延后复核、既有异常不可被焦点事件解除。配合 `node --test tests/*.test.mjs` 和 `bash scripts/security-check.sh`，以本轮最新 HEAD 的三项 GitHub Actions 为最终自动化门禁。

## 限制与发布边界
本轮只缩小恢复事件遗漏窗口，**不解决同步 `persist()` 跨标签写入缺少统一 Web Locks 原子性的根因**。Node VM 事件测试不能代替 iPhone Safari、微信 WebView 实机或真实跨标签端到端验证。保持 PR #58/#59 Open/Draft，不合并 main、不修改正式导航及部署白名单、不部署 Pages/Cloudflare/Edge、不运行线上 Supabase SQL/迁移、不制作美术或作弊后门。
