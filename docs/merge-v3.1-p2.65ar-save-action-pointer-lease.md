# 云屿 V3.1 · P2.65ar：存档操作区旧触控代次保护（未发布）

## P0 风险
原有旧触控代次保护覆盖仓库扩容、收纳和重置，但三个存档导出按钮、导入按钮和取消导入按钮仍采用普通 click 监听。iOS Safari / WebView 的原生文件选择器、BFCache 与兼容 click 可能延迟交付：在选择器打开前按下导出，取消后才收到旧 click，可误发下载；页面离开前按下导入，恢复后旧 click 可重新打开选择器；旧取消点击可能取消新一轮选择。

## 修复范围
复用现有 `persistentGestureGeneration` 和 `guardPersistentChooserClick`，统一保护普通存档、异常重置备份、恢复前备份的导出入口、导入入口及取消入口。选择器开始与页面隐藏 / pagehide 撤销旧指针许可。取消按钮允许在导入等待期间由**新的**触控操作（`allowDuringImport:true`），但拒绝上一轮选择器或 BFCache 的过期触控；键盘 `detail===0` 的原有行为保留。原始导出快照复核、下载许可、Web Locks 和异常证据保全逻辑均不变。

## 专项 Node DOM 回归
1. 三个导出按钮在打开选择器前已按下、取消后才收到兼容 click：拒绝旧下载 URL，剧情键不变。
2. BFCache 离开前按下导入，恢复后迟到 click 不打开选择器；新的触控仍可打开。
3. 旧选择器期间按下取消，新选择器已打开后迟到 click 不取消新选择；新触控可取消。

## 剩余发行阻塞
Node DOM 故障注入不是真实 iPhone Safari / 微信 WebView。仍需真实双标签、BFCache、文件选择/取消、下载落盘、经济多种子与剧情接口集成。localStorage 读写不具备跨标签原子性；Cloudflare Pages 后台部署记录未独立核实。不得自行发布、合并 main、更新导航/部署白名单、操作线上 Supabase 或制作作弊后门。提交必须保留 [CF-Pages-Skip]，最新 SHA 的 Node / security-check.sh / 历史密钥扫描必须全部核验。
