# 云屿百物铺 P3 — 权威云存档及并发保护（开发草案）

状态：**只提交代码；不部署 Edge Function，不执行 SQL，不合并 main，不修改部署白名单。** 美术在独立窗口推进，本轮无任何美术资产变更。

## 设计边界

- P2 当前为浏览器 `localStorage` 试玩档。任何客户端改写的金币、体力、等级、物品、订单或完整存档 JSON 均不得直接写入云端。
- 正式云档首次创建，必须由 Edge Function 使用 `createInitialState(服务器时间)` 生成，绑定已验签 Supabase JWT 中的 `user.id`。
- 浏览器只提交白名单命令 `{ operationId, expectedRevision, action }`，例如生产、移动、订单交付、仓库、建设。禁止携带 `userId` 或 `nextState`。
- Edge 在受信时钟和加密随机数下，用与 P2 一致的 `planTrustedTransition()` 计算结果，绝不信任客户端提供的奖励或随机数。
- 数据库 RPC 采用玩家行 `SELECT ... FOR UPDATE` + `revision` CAS + `(user_id, operation_id)` 唯一约束；重复请求返回**最新权威存档**，避免旧响应回滚状态。
- 冲突返回 409 和最新快照，客户端需重新呈现并确认操作；不能盲目把本地有冲突的队列合并到线上。
- 服务端认证密钥只存在 Edge 环境。`public.merge_saves`、`public.merge_operations` 均启用 RLS，且不对 `anon`/`authenticated` 授予数据表写入或 RPC EXECUTE 权限。
- `supabase/drafts/merge-isle-p3-NOT-APPLIED.sql` 是**未执行草案**，并非正式迁移历史文件；严禁误认为现有数据库已建表。
- `supabase/functions/merge-game/index.ts` 为**未部署草案**；未来需要验证 Deno import、身份验证路径、CORS、双重登录、服务端超时、RPC 同步与生产负载。

## 本轮已写入的代码

- `merge/cloud/authority.mjs`：动作白名单、纯规则可信过渡、并发和幂等参考模型。
- `merge/cloud/db-authority.mjs`：可接 PostgreSQL 的业务编排，凭 `verifiedUid` 提供读档、命令执行、请求哈希及冲突处理。
- `merge/cloud/mock-repository.mjs`：模拟 SQL 事务 CAS/重复提交，供 Node 测试；**不能替代真实数据库的并发验证**。
- `supabase/functions/merge-game/index.ts`：固定合法 Origin、JWT 查询 `auth.getUser()`、只读和操作端点、调用 service-only RPC 的开发草案。
- `supabase/drafts/merge-isle-p3-NOT-APPLIED.sql`：受限 RPC、RLS、操作日志、原子提交 SQL 审查稿。
- `tests/merge-cloud*.test.mjs`：重复请求、并发冲突、篡改经济、身份隔离、旧响应保护、草案权限静态测试。

## 必须完成的发布前验证

1. 先以隔离的**一次性本地测试库**执行 SQL，做数据库级权限证明：对 `anon`/`authenticated` 逐一尝试读取两表、调用两 RPC 均应被拒绝；确认 `service_role` 仅可通过 Edge 使用。
2. 检查既有工具箱会员准入和 JWT 刷新逻辑，决定是否要求 `members` 中有效成员身份；在上线前添加必要的权限判定及测试。
3. Edge Function 的身份验证方式按当前 Supabase Auth 官方文档和部署配置审核；同时测试带 Origin/无 Origin 请求、CORS 预检、错误映射与 JWT 过期。
4. 服务端限制速率、请求体大小和每个用户的操作日志保留期限，观察 DB 操作膨胀、限额以及异常重复调用。
5. 对 PostgreSQL 真实事务进行多实例压力测试（相同 operationId、不同 operationId、冲突、乱序、慢网络、重复发送）。
6. 添加前端云端适配层时不得让未确认的 optimistic 操作覆盖已确认快照，设计重连重放及离线试玩档与权威云档隔离。
7. PostgreSQL 实机验证后才整理真正的 migration 及回滚方案，且只有收到明确数据库部署授权才可以执行。
8. 生产站点导航、Cloudflare 安全构建白名单、GitHub Pages 构建白名单仍保持**完全不变**，需另行取得明确发布授权。

## 已知限制与后续

- 没有数据库级测试结果、真机网络联调或性能延迟测量，不应声称“云存档已上线”。
- Mock 中每个用户无限留存操作日志；正式版需要上限/归档机制，并基于旧 revision 保护避免清理后重复结算。
- 目前 P2 内容为三链六阶示例；后续剧情、美术、高级合成链的接入由其他窗口推进，不应破坏数据结构。
- 本轮用 `node --test tests/*.test.mjs` 验证 Node 本地逻辑，CI 上仍需全量 `node --test tests/*.test.mjs scripts/*.test.cjs`、`bash scripts/security-check.sh`、全历史扫描。