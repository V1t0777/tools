# 云屿百物铺 V3.1 · P2.64a 统一事务 UI 回执契约

## 本轮范围及与 P2.63 的关系

上一轮 P2.63 已完成 Web Locks 页面运行时的双重读回校验和浏览器生命周期协调，但实际 `merge/main.mjs` 仍使用同步 CAS。直接切换四类写入前，必须解决三个实际接线缺口：原版玩家操作的中文失败/成功提示无法从事务协调层传回；计时器零变化仍可能每秒整页重绘；启动迁移提示无法根据可信回执区分新游戏、既有 V3 进度及旧版升级。

本轮将 **同一个事务回执契约** 的三类元数据一次性补齐，避免为了快速接线牺牲用户反馈与移动端性能。只修改独立普通模式研发分支，不启用混合写入路径。

## 三项实现

1. **玩家动作结果**：`commitNormalActionWithLock` 在确定无写入的正常引擎拒绝时保留长度不超过 200 字符的 `message`。版本异常、存档冲突、动作输入污染、异步动作或不确定写入仍只返回阻断原因，不暴露成功消息。
2. **统一运行时回执**：`runtime.action()` 只在 Web Lock 内完成写入、精确读回、同步发布及发布后再校验后，才返回 `{ok:true,status:'UI_PUBLISHED',message}`。正常拒绝返回 `{ok:false,reason:'ACTION_REJECTED',message}`；其余失败不附加动作消息。
3. **启动和计时器**：`runtime.start()` 的 `recovered/migrated` 只在可信发布后返回；`runtime.clock()` 返回 `changed` 布尔值，供未来页面在无变化时只刷新倒计时/补给控件，而不每秒重建棋盘和订单。

这三类元数据来自事务回执而非未经校验的页面内存；运行时依然不暴露未经验证的存档快照。异常回执及 UI 发布失败不得伪装成功。

## 验证

新增 `tests/merge-normal-page-receipt-metadata.test.mjs` 的 12 项专项回归，覆盖新建、既有、V1 迁移和损坏存档的启动元数据；动作成功/拒绝提示、长度限制及无提示兼容；计时器变化与零写入；过期标签阻断及 UI 发布失败不泄露元数据。

原有普通模式运行时、Web Locks、启动迁移、游戏动作、计时器、重置及浏览器生命周期回归均必须继续通过；提交后须核对同一 HEAD 的全仓库 Node、静态安全/部署隔离和完整历史密钥扫描三项 CI。当前环境无法独立完整检出仓库时，必须如实注明本地 `bash scripts/security-check.sh` 未执行，并以 GitHub Actions 实际日志验证脚本。

## 后续完整接线

下一阶段不再补充零散协调器，而应将 `merge/main.mjs` **四类写入一次性迁移**：先持锁启动并完成可交互渲染；玩家动作经 `runtime.action` 且使用本轮的中文消息；每秒 `runtime.clock` 按 `changed` 做局部刷新；确认重置调用 `runtime.reset` 并完成异常原始备份；统一安装 `attachNormalPageLifecycle` 处理 storage/visibilitychange/pagehide/pageshow/focus，取消旧手势，阻断不确定存档。旧同步 `persist` 和直接 `loadLocal` 写入不得与持锁路径混用。旧源码片段型测试须改为实际新页面语义的测试，不能简单删除或放宽断言。

## 发布与实机边界

本轮**没有把运行时接入实际页面**，所以不能宣称现有试玩页面已经获得 Web Locks 跨标签原子写入。Node 内存锁/存储模拟也不是实际 iPhone Safari、微信 WebView、Cloudflare 部署状态或 PostgreSQL/Edge 验收。

禁止修改 main、正式导航、部署白名单、线上 Supabase，禁止合并/发布。PR #58/#59 保持 Open/Draft。提交标题以 `[CF-Pages-Skip]` 开头；即使 GitHub Actions 全绿，也不能代替独立核实 Cloudflare Pages 的预览分支部署设置。
