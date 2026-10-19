# 《云屿百物铺》P3.14 — 损坏云队列只读诊断与证据保全（未发布）

> 范围：仅未来云存档工程；不接入 P2 离线试玩、不制作美术、不合并 main、不更新导航或部署白名单、不发布 GitHub Pages/Cloudflare/Edge、不执行 Supabase SQL 或迁移。PR #58 维持 Draft。

## 目标与安全边界

上一阶段 P3.13 已保证损坏 journal 停止发送且不覆盖原键值。P3.14 增加独立的只读诊断模块 merge/cloud/journal-diagnostics.mjs，进一步区分键缺失、读取失败、非字符串、空字符串、超过长度上限、非法 JSON、结构或操作状态不合法，以及结构合法的 journal。

诊断复用生产队列构造函数及其完整状态校验器，但通过已捕获的原始值和禁止写入的存储代理进行检查。期间不写 localStorage、不读服务器、不发指令，也不把原始内容、账户 ID、幂等操作 ID 或游戏状态放进默认诊断结果。诊断中的 verified 恒为 false、canAutoRepair 和 canResumeCloudWrites 恒为 false：本地结构合法并不证明远端已经验证。

## 证据导出与恢复边界

- exportDamagedCloudJournal() 默认拒绝，只有 confirmedByUser === true 才读取原始内容。
- 仅对确实损坏且可读取的字符串 journal 返回原样证据（文本文档；最多一百万个 JS 字符），不修复、不规范化、不覆盖原键，文件名不包含账户 ID。
- 文本可能含有账户及游戏隐私数据；接入 UI 时只能由玩家明确发起本地保存，不自动上传、埋点、打印日志、粘贴到工单或共享链接。
- storage 抛错、非字符串证据或超限文件时阻断导出，不尝试覆盖、删键或重新初始化。
- 禁止本阶段清空队列和自动重放：损坏前可能已有服务端提交而确认丢失的操作。正确恢复需要先保留原始证据，再通过未来真实服务器的持久幂等日志逐条核对操作 ID 与结果；之后才能讨论严格人工确认、独占锁和无未决操作丢失的恢复机制。

## 验证

新增 tests/merge-cloud-journal-diagnostics.test.mjs：健康/缺键、不合法格式和不可能的持久化状态、只读行为、无内容泄漏、读错误、导出二次确认、字符级保全、超长导出拒绝。

本地命令：

    node --test tests/merge-cloud-journal-diagnostics.test.mjs
    node --test tests/*.test.mjs scripts/*.test.cjs
    bash scripts/security-check.sh

以上必须以 GitHub Actions 实际 CI（完整 Node 回归、安全与部署隔离、完整 Git 历史密钥扫描）为最终依据。未经 CI 成功及后续真实设备、真实后端验收，本阶段绝不能发布。
