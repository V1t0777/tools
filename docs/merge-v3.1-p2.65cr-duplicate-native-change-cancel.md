# 云屿 V3.1 P2.65cr｜普通模式原生文件重复事件与取消授权

时间：2026-10-31（北京时间）。范围：Draft PR #58 的离线普通经营模式，不涉及剧情源文件、云服务、正式导航或部署。

## 复现与根因

正常非空文件选择第一次触发 `change` 后，`acceptSelectedFile` 会立即消费 `importPicker`，然后在异步 `File.text()` 或 Web Lock 中等待。部分浏览器/测试环境可能在同一个原生 input 上再发送一次 `change`。旧处理器在没有有效 picker 时仍调用 `settleSelectedFile`，其快速失败后的 `retire` 会过早移除原生 input。此时若原生 `cancel` 再到达，旧 input 的监听器因身份失效而忽略取消，首个已确认恢复可能在锁释放后继续写入。该问题涉及取消授权可靠性，按 P0 处理。

## 修复

在文件 `change` 入口校验该 input 仍拥有当前 chooser 授权，且没有正在进行的文件读取/恢复单飞。重复、未请求、已消费的 `change` 不再启动第二个异步处理器，不再提前替换原生 input。首次有效选择的取消监听器继续存在，直到原始读取/恢复完成或被取消；原有 BFCache、隐藏选择、空文件、显式取消、锁与备份门禁保持不变。

## 专项回归

- 挂起 `File.text()`：重复非空 `change` 不触发第二次读取、不提前卸载 input；随后原生 `cancel` 必须中止原始读取，迟到文件结果不得确认或写入。
- 恢复确认后等待 Web Lock：重复非空 `change` 不提前卸载 input；随后原生 `cancel` 必须撤销等待中的恢复，不得覆盖普通存档或占用恢复前备份槽。
- 两种情形均核验剧情存档隔离及无额外写入。

## 验证与发行边界

本轮以新 HEAD 的全仓库 Node、`bash scripts/security-check.sh`、静态安全/部署隔离和完整 Git 历史密钥扫描为准；具体结果须在 Actions 完成后单独记录，不能使用上一 SHA 的绿灯。DOM 夹具与 Chromium/CDP 不是 iPhone Safari 或微信 WebView 真机证据。真实原生文件选择器的取消/重复事件、下载和后台恢复仍待用户真机验收。

继续保持 PR #58/#59 Open/Draft；禁止合并 main、发布 Pages/Cloudflare/Edge、操作线上 Supabase 或制作作弊后门。Cloudflare Pages 控制台部署状态若无法独立核实，继续保留风险。
