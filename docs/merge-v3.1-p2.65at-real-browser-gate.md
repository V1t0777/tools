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
