# P112｜首卷真实 Chromium 页面往返与损坏证据门禁（2026-10-29，未发布）

本轮在既有 Node 引擎/DOM 模拟之外，新增 `tests/merge-story-browser-real-p112.test.mjs`。测试通过 Node HTTP 在 127.0.0.1 随机端口服务仓库原始文件，启动隔离临时用户目录的真实 Chrome/Chromium，经 DevTools Protocol 驱动真实模块和 localStorage；找不到浏览器时失败，不以模拟测试代替。

验证三组关联流程：① 剧情页实际阅读并持久化第一章 arrival/signboard，首单尚未交付时「阅读下一幕」必须隐藏、经营入口必须出现；进入剧情工作台确认 56 格与订单门槛，真实生产一次。② 同源第二标签生产后，旧标签被阻断，不能复活旧经营存档；剧情与普通模式哨兵数据不变。③ 仅破坏剧情工作台原始记录，重新加载后必须显示损坏警告，经测试注入的明确确认发起原生 Blob 下载，读取 Chromium 实际落盘 .txt，逐字节核对原始损坏记录，并确认双模式其他存档不变。

本测试不修改金币/关卡/存档格式、正式入口、部署或数据库。原生系统确认框以 window.confirm 测试替身模拟；实际浏览器存储、页面、文件 Blob 和下载路径均真实执行。**尚不能证明 iPhone Safari/微信 WebView 的原生确认、文件落盘、BFCache 或物理触控，也不是四章完整人工通关。** 本轮暂不合并普通分支尚待分诊的 CodeQL medium 告警相关增量；PR #58/#59 维持 Draft。必须以新 SHA 的全仓 Node、静态安全/部署隔离及完整历史密钥扫描三项 CI 结果为准，失败不可标记发行候选。不得合并 main、部署 Pages/Cloudflare/Edge 或触碰生产 Supabase。