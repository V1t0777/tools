# 《云屿百物铺》P3.18 — 云端请求体流式限额与慢速请求防护（未发布）

> 仅修改未来云存档的研发代码和测试。PR #58 保留 Draft。禁止合并 main、修改工具箱导航或部署白名单、发布 Pages/Cloudflare/Edge、执行线上 Supabase SQL/迁移、美术资产修改。

## 修复动机

此前未部署的 Edge 草案在 JWT 身份验证之后执行 `await request.text()`，再用 `TextEncoder` 核查请求是否超过 4096 字节。尽管超限会返回 413，但先将整个请求体读入内存使单次请求在被拒绝前仍可能分配过多内存；同时慢速持续输入没有独立的请求体读取期限。

## 代码变更

- 新增 `merge/cloud/bounded-json.mjs`：提供 `readBoundedJson(request)`，使用 `ReadableStream.getReader()` **按实际 UTF-8 字节数边读取边限制**，上限默认 4096 字节。使用 Content-Length 仅作早期快速拒绝，即使报称很小也必须对传入的真实数据计数。
- 设置整个请求体默认 **5000 毫秒**期限。超过即返回 `BODY_READ_UNAVAILABLE`（HTTP 408），不能继续调用游戏读写、云端凭据查询或服务端数据库；读取异常只暴露固定错误码，不反射请求原文和底层错误。
- 总字节超过 4096 返回 `REQUEST_TOO_LARGE`（413）；非法 Content-Length 返回 `BAD_CONTENT_LENGTH`（400）；空值、非法 JSON、非法 UTF-8 均返回 `BAD_JSON`（400）。
- 中途异常时尝试取消正在读取的流，但**不等待可能永不结束的 cancel Promise**。底层运行时是否及时断开客户端上传，仍需实际 Edge 网络测试确认。
- 修改 `supabase/functions/merge-game/index.ts`：在 JWT 通过之后用流式解析器替换 `request.text()`。原有 origin、token、操作白名单、4 KiB 限额、409/429/503 状态与账户身份绑定保持不变。**不部署** Edge 服务。

## 回归及边界

`tests/merge-cloud-bounded-json.test.mjs` 包含 13 项测试：分块合法 JSON、4096/4097 字节边界、伪造小尺寸、巨大 Content-Length 先拒绝、中文字节计数、非法 UTF-8、截断 JSON、空请求、异常读取、无限等待流、读取期限、配置防绕过及 Edge 接入合同。

本轮可独立运行：

```sh
node --test tests/merge-cloud-bounded-json.test.mjs
node --test tests/*.test.mjs scripts/*.test.cjs
bash scripts/security-check.sh
```

以 GitHub Actions 全量 Node 回归、静态安全/部署隔离和完整 Git 历史敏感内容扫描结果为最终工程验收依据，不因单机测试通过就宣称完成。真实 Deno/Edge HTTP 流行为、跨网络慢速上传、Supabase 权限和一次性 PostgreSQL 并发验收仍未完成，**本阶段不是发布许可**。
