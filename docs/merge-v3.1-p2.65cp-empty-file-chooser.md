# P2.65cp｜普通模式空文件选择事件的旧授权隔离（2026-10-31）
 
## 问题与修复
某些移动端文件选择器在用户未选文件时会发出空 `change`，而非 `cancel`。旧实现仅清空 input.value 与等待状态，复用同一个原生 file input。若随后开始新一次选择，旧选择器的迟到 `change/cancel` 无法与新授权区分，可能误触发恢复确认或取消新读取。
 
本轮在**有当前选择租约且没有在读文件**的空 `change` 路径：撤销租约与排队选择、增加 importEpoch、立即替换原生 input、同步取消按钮；替换失败则 fail-closed 暂停写入。无文件不执行读取、确认、存档覆盖。非空文件选择及已确认恢复逻辑不改。
 
## 回归
`tests/merge-locked-page-dom.test.mjs` 的 P2.65cp 场景覆盖：空 change → 新输入节点 → 旧 change/cancel 迟到 → 新选择器继续有效 → 新文件恢复、原始备份与剧情槽隔离。
 
本地 GitHub DNS 不可用，完整 Node、security-check.sh、静态安全/部署隔离、全历史密钥扫描必须以**本次新 SHA** 的 Actions 结果为准；若失败则本轮不得宣称验证完成。浏览器自动化和 DOM 模拟不能代替 iPhone Safari / 微信 WebView 实机测试。
 
## 未解决
已成功返回非空文件之后、后续原生事件异常重复的边界仍需专项评估；Cloudflare Pages 控制台实际部署状态尚未独立核验。PR #59 的剧情集成和共享文件仍需独立协调，禁止直接覆盖。
