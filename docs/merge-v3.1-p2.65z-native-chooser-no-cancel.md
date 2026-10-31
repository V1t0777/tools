# 云屿 V3.1 · P2.65z 原生文件选择器无 cancel 事件恢复（未发布）

## P0 问题

部分 iPhone Safari 或微信 WebView 的原生文件选择器可能在取消返回时既不派发 `change`，也不派发可靠的 `cancel`。原有 `importPicker` 许可会一直占用，用户无法再次选择存档，只能重新打开页面。此处是兼容性防御，不宣称已在真实 iPhone/微信复现。

## 处理

- 仅在页面重新获得焦点或由隐藏恢复可见后，给仍在等待的同一个选择器 15 秒的迟到 `change` 宽限；之后清除孤立选择器状态，允许用户主动重新选择。
- 回调必须同时匹配选择器对象身份、无正在进行的导入、页面已恢复核验；旧回调不能清理新选择器，不能触发文件读取、确认、恢复或任何存储写入。
- 原有 `cancel`、`pagehide`、BFCache、`AbortController` 和恢复前备份锁内校验不变；无可用定时器时保守保持原有阻断。

## 回归

`tests/merge-locked-page-dom.test.mjs` 新增三项实际 HTML 入口 DOM 模拟：无 cancel 的 focus 返回、有效迟到 change、旧超时与新选择器隔离及 visible 返回。需以本次新 HEAD 的完整 Node / `bash scripts/security-check.sh` / 全历史密钥扫描 GitHub Actions 三项结果为准。

## 未消除的风险

15 秒后才到达的真实有效文件选择事件会被安全拒绝，需重新选择；某些 WebView 若完全不派发 focus/visibility/cancel/change，仍需重开页面。模拟 DOM 不是 iPhone Safari/微信实机。真实文件落盘、双标签与 BFCache 仍是发行门禁。此改动不触及剧情、main、部署、云服务或线上数据；PR 保持 Draft，不发布。
