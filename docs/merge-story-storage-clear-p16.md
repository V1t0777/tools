# P16：跨标签清空事件与旧页面操作阻断（未发布）

## 实际缺口
Web Storage 在其他标签页调用 `localStorage.clear()` 时，会在当前标签触发 `storage` 事件，其 `key === null`；此前两个剧情页面仅监听具体故事存档键，未直接处理清空事件，旧页面可能继续显示可操作 UI。虽然原有精确原文 CAS 通常会拒绝下一次过期写入，但用户仍看见过期界面，且旧回调仍可能执行。

## 变更
- 新增 `merge/story/storage-event-guard.mjs`：仅识别两个剧情存档键及其 `storageArea`，把 `key === null` 视为必须重新核对的清空事件；来自明确不同存储区域（如 sessionStorage）的事件不触发。
- 剧情工作台收到相关事件后进入只读状态、清除当前选中材料；`commit` 新增早期 `blocked` 检查，阻止已排队的旧回调绕过 UI 禁用继续写入。
- 剧情对白页收到相关事件后清除选择并关闭已打开的对白框；正常进度保存新增 `blocked` 检查，明确用户确认的重置仍由既有原文 CAS 保护。
- 不新增存档键、不更新经济、故事进度或普通模式逻辑，不访问服务器、Supabase 或部署配置。

## 回归与局限
- `tests/merge-story-storage-clear-p16.test.mjs` 验证双剧情键清空事件、无关键/无关存储区域、非法事件拒绝、真实引擎工作台过期快照被 CAS 拒绝、UI 关闭及只读契约。
- **这不是解决同时写入的原子事务机制**。两个标签几乎同时执行同步 `getItem/setItem` 的时间窗、BFCache 与 iOS/微信实机事件时序仍需额外测试，未来需 Web Locks（如支持）或权威服务端事务等机制。
- 首版仍缺 iPhone Safari / 微信 WebView 真人验收和正式美术/叙事内容审校。

## 验证
最终提交必须运行 Node 测试、`bash scripts/security-check.sh` 和完整历史安全扫描，并以最终 GitHub Actions 3 项结论为准。

**发行边界**：保持 PR #59 Draft，禁止合并/修改 main、发布 Pages/Cloudflare/Edge、改正式导航或部署白名单、线上 SQL/迁移、生产数据和作弊后门。
