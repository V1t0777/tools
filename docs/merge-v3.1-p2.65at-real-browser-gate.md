# V3.1 P2.65at｜普通模式真实 Chromium 双标签与页面往返门禁（未发布）

## 本轮目的
过去的 `tests/merge-locked-page-dom.test.mjs` 使用 Node DOM 事件夹具，能够验证同步事件次序，但无法证明真实浏览器的同源 `localStorage`、Web Locks、后台标签调度、页面历史往返及 Blob 下载。新增 `tests/merge-browser-real.test.mjs`：由现有 `node --test tests/*.test.mjs` 自动执行，无第三方依赖、无部署或云服务；测试必须找到真实 Chrome/Chromium，缺失时失败，不把跳过误报为浏览器通过。

## 可复核的浏览器场景
1. 在本机随机端口提供仓库源文件，Chrome 独立临时用户目录打开普通模式两个同源标签，验证首次存档与生产后的 revision、体力变化。
2. 重新激活旧标签，验证界面采用另一个标签的新存档，避免仅检查共享 localStorage 而漏掉旧 UI。
3. 在标签 B 持有真实同名独占 Web Lock，标签 A 尝试生产必须零写入；释放后 A 新操作才允许成功。
4. 导航离开再通过浏览器历史返回，验证存档不回滚、页面恢复后仍可核验；记录 `pageshow.persisted`，仅为 `true` 时才说明本次真正使用 BFCache。
5. 允许真实浏览器下载原始存档，等待文件落盘并检查内容含有存档字段。此验证仅针对 Chromium 桌面环境，不代表 iPhone/微信下载成功。

## 环境与安全
- 使用 Node 原生 HTTP、WebSocket、child_process 和 Chrome DevTools Protocol；不引入包管理器或浏览器测试云服务。
- HTTP 仅监听 `127.0.0.1` 随机端口；浏览器用户目录、下载目录为临时目录，结束后清理；不访问 Supabase。
- 测试脚本只运行普通模式 `merge/index.html`；不修改正式导航、白名单、生产数据库、剧情源文件或部署配置。
- 当前本地容器 Chrome 受组织 `URLBlocklist: ["*"]` 策略限制，拒绝访问 loopback 页面，故本地无法取得真实浏览器通过证据；必须以对应新 SHA 的 GitHub Actions 实际日志为准。禁止用 `node --check` 冒充浏览器通过。

## 发行边界
CI 真实 Chromium 通过仍不等于 Safari、微信 WebView、触控和文件下载实机通过。若 CI 失败，必须如实报告并修复，不能宣称 P0 已消除。PR #58/#59 保持 Open/Draft；禁止 main 合并和任何正式部署；Cloudflare 后台部署记录若无法核实继续列为风险。

## P2.65au｜真实浏览器组合回归加强（2026-10-29，未发布）
- BFCache 门禁从仅记录改为 **必须观察到** `pageshow.persisted === true`；如果 Chromium 没有真正使用 BFCache，则本次测试失败，不能把普通历史返回冒充 BFCache 验证。
- 下载不再只验证 JSON 字段存在，还必须解析并与浏览器实际存档状态完整一致。
- 在真实 Chromium 两标签环境连续执行「下载存档 → B 标签确认重置 → A 标签识别 revision 回退并安全阻断旧操作 → B 标签读取刚下载的 File 并恢复 → 验证恢复前备份为重置后的精确原始字节 → A 标签重新加载并核验恢复结果」。校验恢复数据与下载文件一致，且旧标签不允许复活重置前进度；重新加载后页面显示的体力一致。
- **测试注入边界：** 为避免无头 Chromium OS 文件选择器及模态确认的不稳定性，测试仅用 `DataTransfer/File` 注入文件选择、用 `window.confirm` 确认；实际文件读取、Web Locks、页面运行时、localStorage、备份、双标签事件及下载仍由浏览器执行。此测试不能证明 iPhone Safari/微信 WebView 的原生选择器、系统下载落盘或物理触控。
- 如果本次新 SHA 的 Node / 安全隔离 / 完整历史密钥扫描任一失败，不得标记为已通过。所有 PR 保持 Draft，不发布、不触碰 main、正式导航、Cloudflare、Supabase。

- **首次组合 CI 发现并纠正测试预期：** 跨标签确认重置将 revision 从较高值降回 0，旧标签必须因回退而安全阻断，不允许直接采用低 revision 快照。首轮测试错误地等待旧标签自动采用重置，真实 Chromium 在该步骤超时（1180/1181）；本次修正验证阻断、零旧写入及重新加载后的恢复状态。不得为通过测试放松运行时的回退保护。
