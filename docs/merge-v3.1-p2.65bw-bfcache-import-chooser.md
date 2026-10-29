# P2.65bw — BFCache 返回后旧文件选择结果失效（未发布）

## 目标与范围
本轮仅补充普通经营模式 P0 浏览器组合回归，不改运行时、经济数值、存档格式、剧情源文件、部署配置或正式导航。承接 P2.65bv 的真实 BFCache 验证，覆盖尚未单独验证的“文件选择器打开后页面离开，再返回时旧文件 change 事件延迟到达”。

## 真实 Chromium 验证路径
1. 普通经营页面启动导入选择，确认取消等待控件可见。测试拦截原生系统选择窗口的打开动作，保留真实页面、File 对象和文件输入 DOM。
2. 通过真实 Chromium 导航离开并使用历史记录返回，**必须观察 pageshow.persisted === true**；不能以合成 pageshow 替代。
3. 向 BFCache 保留的原文件 input 投递迟到的 JSON change 事件，确认不会弹恢复确认、不覆盖普通存档、不占用恢复前备份、不影响剧情存档。
4. 在同一恢复页面重新开启选择器并取消，确认按钮状态正常恢复、无需刷新，原存档字节保持不变。

这验证的是 Chromium BFCache 与可控原生选择时序组合，不等于 iPhone Safari 或微信 WebView 系统文件选择、后台恢复、文件落盘实测。未执行线上服务端操作。

## 验证与发行门禁
必须以本提交最终 SHA 对应的 GitHub Actions 全仓库 Node、`bash scripts/security-check.sh`/部署隔离、完整历史密钥扫描三项真实结果为准；未全部成功不得宣布通过。PR #58/#59 保持 Open/Draft；提交保留 [CF-Pages-Skip]；不合并 main、不发布 Pages/Cloudflare/Edge、不改正式导航/白名单、不执行 Supabase SQL/迁移、不制作作弊后门。Cloudflare 控制台真实部署状态无法独立核实时保留风险。11 月 10 日候选版仍取决于真实 iPhone/微信验收、经济卡局与首卷集成。
