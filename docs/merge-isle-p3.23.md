# 云屿百物铺 P3.23：凭据查询统一时限（未发布）

## 问题与修复

之前服务端只读取证路径依次执行共享限流 RPC 和数据库历史凭据查询，各阶段都单独使用完整的 5 秒超时预算。若两阶段均接近超时，总等待时间可能接近 10 秒，延长失败反馈。

本轮在身份及操作编号验证后创建**单个单调时钟截止点**，先用于共享限流，后用于历史凭据查询。第二阶段只可使用剩余预算；若额度耗尽，不再发起数据库查询，固定返回 HTTP 503 和 `RECEIPT_SERVICE_UNAVAILABLE`。不能据此自动重放操作、清除待确认队列或恢复云端写入。查询超时无法保证撤销已经发送的 SQL，额度可能已经被扣除。

为便于稳定、无真实数据库的回归，服务构造器允许受信任测试代码注入单调时钟；生产默认使用 `performance.now()`。专项测试覆盖限流耗尽预算后不发起凭据查询、正常快速查询保持只读，以及非法时钟配置拒绝。代码不新增外部依赖。

## 验证与边界

运行 `node --test tests/merge-cloud-receipt-deadline.test.mjs`、全仓库 Node 测试、`bash scripts/security-check.sh` 和 GitHub Actions 完整历史敏感内容扫描。以最新提交全部 CI 结果为准。

仍未完成一次性 PostgreSQL 真实并发、RLS/角色登录、真实 Edge 网络及 iPhone/微信 WebView 测试。本轮仅限 Draft PR #58 研发分支；不合并 main，不部署 Pages/Cloudflare/Edge，不执行线上 Supabase SQL，不制作美术素材。
