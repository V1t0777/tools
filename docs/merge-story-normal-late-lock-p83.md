# P83 · 普通模式延迟锁与剧情双存档隔离（未发布）

## 本轮范围
- 安全前向同步 Draft PR #58 的 P2.65p–r：普通模式导入后台取消、恢复锁生命周期及迟到的动作/计时/重置写入阻断。同步前检查共同祖先、上游 16 个变更路径与剧情分支重叠为零；不修改普通模式经济规则。
- 新增真实事务模块回归 `tests/merge-story-normal-late-lock-isolation-p83.test.mjs`：普通模式动作等待锁时，剧情对白仍可独立提交；普通模式后台失效后，迟到动作不执行、不覆盖剧情或普通存档。
- 同时覆盖普通模式重置等待锁期间后台失效：不得先占用异常备份槽、覆盖普通存档或触碰两份剧情存档。

## 验证
```sh
node --test tests/merge-story-normal-late-lock-isolation-p83.test.mjs
node --test tests/*.test.mjs
bash scripts/security-check.sh
```
最终结果以该 SHA 的 GitHub Actions 三项门禁为准：Node 游戏与安全回归、静态安全/部署隔离、完整 Git 历史密钥扫描。若任何门禁失败，不能认定本轮通过。

## 风险与发行边界
- 此测试为 Node 中可控 Web Locks/存储模拟，不是 iPhone Safari、微信 WebView 或 Windows 真机验收；也不能证明 localStorage 跨标签原子性。
- iPhone 原生确认框、BFCache、跨标签恢复和损坏存档下载落盘仍需人工验收。11 月 10 日仅为目标日期，质量不达标则延期。
- PR #58/#59 均保留 Draft；禁止合并 main、修改正式导航/部署白名单、发布 GitHub Pages/Cloudflare/Edge、执行线上 Supabase SQL/迁移或接触生产数据。
