# 《云屿百物铺》V3.1 · P2.65m 隐藏态文件 change 安全排队（未发布）

范围：Draft PR #58 的普通模式真实入口与 DOM 专项回归。继续冻结离线单机首发范围，不改剧情分支、main、正式导航/白名单、Cloudflare、线上 Supabase 或云同步功能。

## P0 缺陷与修复

某些 iPhone Safari / 微信 WebView 原生文件选择器可能先在页面 hidden 时派发 `change`，再派发 visible。P2.65l 只允许“先 visible 后 change”，对该事件顺序会拒绝正常导入。

本轮在已由用户点击、且仅经历一次无 pagehide 隐藏的选择器票据下，隐藏态 `change` **仅暂存 File 句柄**，不调用 `file.text()`、不预检、不弹出确认、不写入存档。页面重新 visible 后，排入微任务，等待正常页面生命周期桥完成同步核验，再按原始 raw 与 importEpoch 校验票据，之后才允许执行既有文件大小/结构预检、两阶段用户确认、Web Locks、原始备份与写回核验。新一轮选择前清空 input.value，避免同名文件重选无 change。

任何 pagehide/BFCache、第二次 hidden、取消、重复 change 或跨标签原始字节变化都拒绝旧票据；异步文件读取和确认期间发生隐藏仍使用原有 importEpoch 阻断。拒绝后不写入普通或剧情存档，也不占用恢复前备份槽。

## 专项回归与验收边界

新增四组真实 HTML 入口 DOM 测试：隐藏态 change 到 visible 的正常恢复（读取/确认必须延后）、pagehide 撤销、跨标签基线变化撤销、重复/取消/二次隐藏撤销。原有导入、重置、BFCache 与触控回归仍须执行全仓库 Node 测试及 `bash scripts/security-check.sh`；完整历史密钥扫描以**本轮新 SHA** 的 CI 为准。

真实 iPhone Safari、微信 WebView、文件选择器实际事件顺序、下载落盘及双标签浏览器仍未实测；GitHub CI 不等于真机验收。Cloudflare Pages 实际部署记录未独立核实前不得声称零部署。两 PR 保持 Open/Draft，不合并、不发布，11 月 10 日仅依据证据建议或拒绝 RC，须用户另行授权发布。
