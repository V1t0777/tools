# 《云屿百物铺》V3 · P2.61e 原始存档恢复锁回调可信性（未发布）

## 风险
P2.60 已统一普通模式恢复与游戏事务的 Web Locks 锁名，但旧恢复适配器仅凭首次回调被调用及返回值的 `ok` 判断结果。异常锁提供者可重复执行回调、在请求结束后迟到调用，或返回并非回调实际生成的成功回执。即使存档基线 CAS 阻止第二次覆盖，也不应把这种异常标记为恢复成功。

## 单一工程增量
仅加固 `merge/save-restore-lock.mjs`：每个锁请求至多允许一次回调；请求完成/失败后禁止迟到回调；验证 Web Locks 请求结果与实际回调回执为同一对象。若首次恢复已写入但提供者重复回调或伪造回执，返回 `RESTORE_OUTCOME_UNCERTAIN`，**绝不自动回滚、重试或删除备份**。未执行回调则返回 `LOCK_RESULT_INVALID`。原有正常恢复、锁忙、锁无效、确认缺失及异常备份行为不变。

## 专项回归
`tests/merge-save-restore-lock.test.mjs` 增加三项：重复回调仅一次写入且结果不确定；请求完成后迟到回调无法写入；伪造成功回执不能宣称恢复成功。使用 `node --test tests/merge-save-restore-lock.test.mjs`，配合全仓库 Node 回归、`bash scripts/security-check.sh`、完整 Git 历史密钥扫描；是否通过以**本提交 SHA** 的 GitHub Actions 三项真实结论为准。

## 未解决问题与边界
此恢复模块尚未接入普通模式页面，`merge/main.mjs` 仍有同步 `persist()`，因此**不能宣称跨标签存档写入已原子化**。异常锁提供者属于故障注入测试，不代表真实 iPhone Safari、微信 WebView、PostgreSQL 或 Edge 实机验收。PR #58/#59 保持 Open/Draft；不合并 main、不修改正式导航/部署白名单、不发布 Pages/Cloudflare/Edge、不执行线上 SQL/迁移、不制作美术或作弊后门。
