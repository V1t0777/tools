# 《云屿百物铺》V3 · P2.39 storageArea 来源隔离（未发布）

## 问题
普通模式已处理其他标签的存档键更新与 localStorage.clear()，但浏览器 storage 事件也可能来自同一顶层上下文的 sessionStorage（例如嵌入的同源 iframe）。若它恰好使用相同键名或触发 clear()，此前监听器会误将其视为普通模式 localStorage 事件，导致无关事件触发额外读取或误报存档冲突。

## 单一工程增量
- `merge/main.mjs`：要求 `event.storageArea === store`，只处理当前普通模式 localStorage 区域的事件；异区域同名键、异区域 clear、来源不可确认的事件直接忽略。保留 P2.38 对本区域 `key===null` 的保护。
- `tests/merge-storage-event-policy.test.mjs`：更新已有 Node VM 回调模拟使其携带 storageArea；新增异区域同名键、异区域 clear、未知来源的忽略测试，验证本区域事件仍触发原有保护。
- 不读写剧情模式、不新增存储键、不触及正常游戏资源和部署配置。

## 验证与限制
Node VM 仅验证回调逻辑，不等于真实浏览器双标签/iframe 或 iPhone Safari/微信 WebView 实机。若某浏览器不能暴露 storageArea，此过滤器会忽略事件；实际写入仍依靠 existing expectedRaw 校验安全失败，尚未实现 Web Locks 事务化写入。CI 需核对本次 HEAD 对应的全仓库回归、静态安全及部署隔离、完整 Git 历史密钥扫描三项全部成功后方可标记工程验证完成。

PR #58/#59 保持 Open/Draft；不修改 main、不合并、不发布、不修改部署白名单、不操作线上 Supabase、不制作美术或作弊后门。
