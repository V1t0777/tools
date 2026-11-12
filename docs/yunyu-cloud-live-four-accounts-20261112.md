# 云屿百物铺 · 四账号私有云存档上线说明

发布日期：2026-11-12。服务端只向 Supabase Auth 已验证邮箱、且精确 UID 在 `merge_cloud_allowlist` 的迪、晨、钊、test 四个账号开放。

## 架构和发布边界
- 普通经营 **云端模式是独立新档**：金币、物品、体力由可信 Edge 和 PostgreSQL CAS 决定，客户端操作编号持久化，断网后重试。绝不把离线金币直接写入云端。
- 剧情与剧情工作台：**手动确认的双档云备份/恢复**；两份数据在本机原子快照，恢复前必须下载旧档并再次确认，冲突时拒绝覆盖。
- 旧经营存档的管理员一次性迁移不在本次发布范围内；有关 SQL 审核稿未应用；`claim` 请求返回不可用，界面隐藏审批区。
- 浏览器客户端仅由 `cloudflare-secure/build.sh` 构建到 `dist-secure/merge/`，发布访问入口为 `https://zhao-toolbox-secure.pages.dev/merge/cloud-preview.html`。GitHub Pages 主站只发布无 Auth 的本地试玩版。
- 正式 SQL 迁移已于本日运行，记录在 `supabase/migrations/20261112024400_yunyu_four_account_cloud_initial_20261112.sql`；服务端函数 `merge-game` / `merge-story` 均保持 `verify_jwt=true`，同源策略限制至安全镜像。
- 不能将模拟测试、SQL 事务测试或自动 CI 当作四个真实账号跨 iPhone/PC 登录的成功证明。发布后须由账号持有人验收身份、跨设备同步、异常重试和剧情恢复。

## 失效回退
- 旧版 GitHub Pages 的离线 `/merge/` 不受此次云端发布影响，可继续使用且本地进度保留。
- 如果用户端故障，不要清空存档、撤销账号或删除数据库表；先在 Cloudflare 构建白名单撤下云端页面链接，保留数据库及未确认命令供诊断。
- 生产 Supabase Free 未配置自动托管备份；应定期通过受控渠道导出备份。
