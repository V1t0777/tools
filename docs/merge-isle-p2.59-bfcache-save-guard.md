# 《云屿百物铺》V3 · P2.59 BFCache 返回时只读复核存档（未发布）

## 背景与风险
P2.58 已在 `visibilitychange` 恢复可见时重新读取普通模式存档，阻止后台标签持过期原始字节继续写入。但浏览器从往返缓存（BFCache）恢复页面时，可能收到 `pageshow.persisted === true`，而不保证出现新的可见性切换事件。若此时另一标签已修改、删除或损坏本地存档，旧页面不应凭过期内存状态继续游玩。

## 本轮最小改动
- 将 P2.58 的原始字节只读复核提取为 `revalidateResumedSave()`，供原 `visibilitychange` 与新增 `pageshow` 事件复用，避免两套判断规则漂移。
- 仅在 `pageshow.persisted === true` 且页面可见时额外复核；首次正常加载不重复读取。若 BFCache 恢复时仍隐藏，则等待后续可见性事件复核。
- 发现当前存档缺失、损坏或原始字节变化时，保持 `persistedRaw` 原值、取消旧拖拽和选择，暂停写入并提示备份核对；不自动合并、迁移、重置或写回。
- 已处于异常阻断状态的页面不会因 BFCache 事件自动解除阻断。普通模式与剧情模式数据、经济数值、云存档均不改变。

## 专项回归
`node --test tests/merge-background-resume-guard.test.mjs` 新增五项 BFCache 事件验证：首次 `pageshow` 无多余读取、原始字节不变保持可用、变化时取消手势并阻断、隐藏恢复延后核验、已有阻断不解除。复用既有 P2.58 可见性及后台计时器测试。必须以**最新 HEAD** 的全仓库回归、静态安全/部署隔离、完整 Git 历史密钥扫描三项 GitHub Actions 实际结果为准；不能以旧 SHA 的 CI 代替。

## 仍存限制
这只是恢复事件的只读安全补丁，不等于普通模式全部写入口已统一接入 Web Locks；同步 localStorage 的跨标签原子性问题仍需后续研发。Node VM 模拟不能替代 iPhone Safari、微信 WebView 的 BFCache、真实下载及触摸实机验收，也未执行任何 PostgreSQL/Edge 验证。

## 发布边界
仅限 `feat/merge-isle-p0-p1` 草稿研发分支；PR #58/#59 保持 Open/Draft。禁止合并 main、修改正式导航或部署白名单、发布 Pages/Cloudflare/Edge、执行线上 Supabase SQL/迁移、制作美术或作弊后门。
