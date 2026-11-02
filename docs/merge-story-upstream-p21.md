# 《云屿百物铺》P21 · P2.37 上游安全同步（未发布）

- 上游 Draft PR #58：`116fc303b5ece6495cac4f1eb6f921be7e438dd4`。
- 剧情 Draft PR #59 同步前：`bee1cf37367dda5c22e093df7ffc0edd62937c32`。
- 三方路径核对：上游 P2.37 的 `merge/reset-backup.mjs`、`tests/merge-reset-backup.test.mjs`、`docs/merge-isle-p2.37-reset-backup-exportability.md` 均未在剧情分支自分叉点以来修改；使用原始上游 blob、保留双父提交历史，不强推。
- 上游功能：异常普通模式存档重置前备份现在调用现有导出预算校验，避免备份可写入却无法按当前导出器编码或下载。中文 UTF-8 过大、孤立 UTF-16 代理项封装超限、编码器不可用均拒绝授权重置。
- 剧情专项：`tests/merge-story-upstream-p21.test.mjs` 增加两项真实存储读写模拟，验证超限失败与合法异常文本备份两条路径都不读取/写入剧情对白和剧情工作台存档键。
- 本次没有修改故事正文、经济数值、正式导航、部署白名单或任何生产服务。

## 后续风险

此上游补丁只保证浏览器内备份符合当前导出器预算，不能保证 iPhone Safari / 微信 WebView 真机下载成功；浏览器数据清理仍可能丢失同源备份。跨标签同时写入缺少原子 CAS，仍须继续设计兼容性降级方案。CI 通过不代表真机验收或可发布。

## 门禁

最终提交须在 GitHub Actions 完成全仓库 Node 回归、静态安全与部署隔离（含 `bash scripts/security-check.sh`）、完整历史密钥扫描；全部结论核实后才报告通过。PR #59 始终 Draft；不写入或合并 main、不部署、不执行线上 Supabase SQL、不接触生产数据。
