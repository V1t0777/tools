# 云屿 V3.1 P2.65ap｜常驻按钮跨选择器/BFCache 旧指针许可（未发布）

## P0 风险
普通经营模式的仓库扩容、原料收纳、确认重置是常驻按钮。P2.65ao 已阻止“文件选择器期间 pointerdown、取消后 click”，但仍存在另一种事件顺序：用户先按住常驻按钮，随后原生选择器开始并取消，旧兼容 click 才到达；旧的 stalePointer 只在 pointerdown 当时检查 importPending，可能漏掉这次过期授权。BFCache pagehide/pageshow 同样可能跨越一次指针操作。不能把过期 click 当作新操作或新重置确认。

## 修复
为常驻按钮记录 pointerdown 时的本地交互代次。开始原生导入选择器、页面 pagehide、页面隐藏时递增代次；随后到达的非键盘 click 若代次失效，只显示中文提示，不执行经营或重置。继续保留 chooser-era pointercancel 防护，键盘 detail=0 仍作为新的独立意图处理。新 pointerdown 可在页面安全恢复后重新授权。没有改经济数值、存档结构、Web Locks、导入/导出格式或剧情源文件。

## 真实源码专项回归
- 原生选择器打开**之前**按下仓库扩容，选择器取消之后才收到旧 click：必须零写入、零扣费；新触控仍可正常升级。
- BFCache pagehide **之前**按下重置，pageshow 后收到旧 click：不得弹出破坏性确认、不得覆盖存档；新触控可重新确认。
- 两项均核对普通模式原始存档和剧情存档隔离。

专项命令：`node --test tests/merge-locked-page-dom.test.mjs`；全仓库 Node、`bash scripts/security-check.sh`、部署隔离、完整历史密钥扫描以**本次最终 HEAD** 对应 GitHub Actions 为准，未通过不得标记完成。

## 未解决与发行硬边界
模拟 DOM 不等于 iPhone Safari/微信 WebView 实机，仍需双标签、BFCache、文件导入导出与下载落盘的真实浏览器操作链路。Web Locks 不会让 localStorage 变成跨标签原子事务。PR #58/#59 保持 Open/Draft，不合并 main、不修改正式导航或部署白名单、不操作线上 Supabase、不部署 Pages/Cloudflare/Edge、不制作后门。11 月 10 日仅根据验证证据决定是否推荐 RC，必须另获发布授权。
