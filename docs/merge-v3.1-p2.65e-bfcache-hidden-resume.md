# 《云屿百物铺》V3.1 · P2.65e BFCache 隐藏态恢复门禁

**范围：PR #58 普通经营独立 Draft 分支，未发布。**

## P0 风险与复现

部分移动浏览器可能在 `document.hidden === true` 时先派发 `pageshow`，随后才派发可见的 `visibilitychange`。旧生命周期桥接器直接忽略隐藏态 `pageshow`，保留 `pageGone=true`；可见事件又拒绝在 `pageGone` 时核验，导致页面永远停留在“已暂停”，除非重新加载。此为可用性/恢复死锁，不是 Web Locks 互斥失效。

## 修复

- `pagehide` 清除旧恢复凭据，保持写入暂停；隐藏态收到有效 `pageshow` 只登记待核验恢复，不执行读写或解除暂停。
- 后续 `visibilitychange` 变为可见时，只有登记过 `pageshow` 才触发只读 `runtime.reconcile()`；核验通过后清除 `pageGone` 与隐藏暂停，恢复玩家输入。没有 `pageshow` 时，单纯焦点或可见性变化不能解除 `pagehide`。
- 存档损坏、同版本分叉、存储不可读或 UI 回调异常继续阻断，绝不自动覆盖原始数据。所有路径均不写入存档或剧情模式。

## 验证

新增 4 项生命周期回归与 2 项真实普通模式 HTML 入口的 DOM 模拟测试：隐藏态 BFCache 恢复、只读采纳更新、损坏数据拒绝、二次 `pagehide` 撤销待恢复资格、输入恢复与存档字节保护。最终三项 CI 必须核对**本次提交 SHA**：Node 全仓库回归、`bash scripts/security-check.sh`/部署隔离、完整历史密钥扫描；未全部通过不得标记完成。

## 仍需真实验收

Node 事件模拟不等于 iPhone Safari/微信 WebView 真机；需要检查 `pagehide → pageshow(hidden) → visibilitychange(visible)`、连续多次 BFCache、双标签并发及下载落盘。Cloudflare 预览分支配置仍缺独立核验；PR #58/#59 保持 Draft，不改 main/导航/白名单，不部署、不操作线上 Supabase。离线首发不依赖云同步。
