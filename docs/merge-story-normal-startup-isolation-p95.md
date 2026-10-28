# 云屿剧情 P95｜普通模式启动撤销与剧情双存档隔离（未发布）

## 本轮范围
- 安全同步普通经营 P2.65ad 的启动生命周期撤销：普通模式等待 Web Lock 期间离开页面、首次读取期间页面隐藏，不得继续创建/迁移/推进普通存档。
- 剧情侧补充真实普通启动事务的交叉回归：正常启动只写普通存档；锁等待撤销零写入；异常 UTF-16 剧情证据在同步失效时原样保留。剧情对白与剧情工作台的两个独立键均验证。
- 不修改首卷剧情、金币、经验、存档格式或正式入口。此次上游合并为双父提交，保留 PR #58 历史，不强推。

## 核验
- `node --test tests/merge-story-normal-startup-isolation-p95.test.mjs`
- `node --test tests/*.test.mjs`
- `bash scripts/security-check.sh`；完整 Git 历史密钥扫描以最终 SHA 的 GitHub Actions 为准。
- 不将 Node 模拟、CI 或 GitHub checks 缺少 Cloudflare 项等同于 iPhone/微信真机或 Cloudflare 后台验收。

## 风险与下一步
- `localStorage` 不提供跨标签原子事务，Web Locks 只协调参与者。
- iPhone Safari、微信 WebView 的 BFCache、文件下载落盘、原生确认框和跨标签竞争尚未实机验证；Windows 离线首卷四章手工通关仍需验收。
- 继续保持 PR #58/#59 Draft；禁止修改 main、正式导航、部署白名单，禁止发布及线上 Supabase 操作。
