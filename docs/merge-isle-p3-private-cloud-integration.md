# 云屿百物铺 P3 私有云存档集成研发包（Draft，未部署）

## 可测试的完整云端研发链路
四个身份核验通过的账号 → 独立账号云队列 → 认证 HTTP → Supabase Edge 访问白名单
→ 服务端经营引擎 → 独立经济审计 → 幂等 operationId + revision CAS → PostgreSQL 草案。
HTTP 客户端经每次 getUser() 验证后将 Bearer 仅发往预设 Supabase 项目，不信任昵称、
user_metadata、任意客户端金币或自报存档，不跟随任意第三方跳转。
客户端队列保留原 ID、掉线重试、跨标签 Web Locks 协调、冲突人工核验、状态只读预览。

本轮将普通模式已有的补给使用、限额补给购买、严格死局弃置加入云端命令权限和审计，
统一数据库 schemaVersion=3，调整 SQL 草案 UTF-8 上限并增加双标签 HTTP/服务端模拟端到端回归。
旧的本地存档不会被自动导入、重置、清除或升级为可兑换云端经济。

## 严格保留的上线前阻塞
- 服务端 SQL 草案和 Edge Function 未部署；测试模拟不能代替真实独立 PostgreSQL RLS/事务验收。
- 普通经营本地 IndexedDB 写入整合、无 Web Locks 的云队列 IndexedDB 协议、
  旧档与云档初次绑定及不可逆冲突的人工确认、剧情双键同步协议尚需工程集成。
- 完整游戏 UI 尚未切换到云端模式；只读状态不能擅自表示远端已确认。
- 必须独立完成 iPhone Safari / 微信 WebView、Windows、多设备、真实断网/掉电及备份恢复验收。
- 绝对禁止在未获得明确生产发布授权前执行 Supabase SQL/migrations、
  部署 Edge Function、合并 main、修改 Cloudflare/Pages 构建白名单或正式导航。
