# P2.65co｜移动端生命周期撤销后的原生文件选择器隔离

- 日期：2026-10-31（北京时间）。范围：Draft PR #58 的离线普通经营模式，不涉及剧情源文件、共享 HTML/CSS、正式导航或线上部署。
- 真实缺陷：pagehide/BFCache 或第二次隐藏已撤销选择授权，但原生 input DOM 仍复用。旧 iOS/WebView 选择器的迟到 change/cancel 若恰好落在新一次点击后，可能借用新选择器的授权，错误读取旧文件。
- 修复：生命周期撤销时记录待轮换标记；下一次明确点击导入、建立新 picker lease 之前，在同一个用户手势中更换原生 input。旧节点事件通过既有 input 身份检查被拒绝。若替换失败，fail-closed 暂停操作；不写存档或备份。
- 回归：扩展 P2.65l 两种撤销序列与 P2.65p 挂起读取/BFCache 场景，核验旧节点迟到 change/cancel 不能恢复、真正新节点可恢复、备份及剧情命名空间隔离。
- 验证边界：须等待本次新 HEAD 的全仓库 Node、security-check.sh、静态部署隔离和完整历史密钥扫描；CI/Chromium 不等于 iPhone Safari 或微信 WebView 真机验收。
- 仍待处理：PR #59 共享 HTML/CSS/运行时接口三方集成、真机文件选择与下载、Cloudflare Pages 后台独立核查。未进入 RC，不发布。
