# P2.61p · 普通模式拖拽落点延迟求值（未发布）

## 范围与行为
普通模式真实页面 `merge/main.mjs` 的拖拽落点由提前执行 `moveOrMerge(state,...)` 调整为向既有 `commit(result)` 入口提交延迟动作 `commit(current=>moveOrMerge(current,...))`。保留拖拽完成时已有的原始存档只读检查，随后在统一动作入口再次核验原始字节，才允许计算合成/移动。

关键竞态：落点检查与 `document.elementFromPoint()` 之间，其他标签可能更新存档。原实现先计算引擎结果，统一入口随后拒绝写入；现在第二次核验发现变化时，连旧状态的合成计算也不执行。正常成功、引擎拒绝、落点不在棋盘、取消拖拽与延迟合成点击保护保持原语义。没有修改经济、存档格式、云同步、部署或美术。

## 专项回归
新增 `tests/merge-drag-deferred-gateway.test.mjs`，直接抽取真实页面的 `completeDrag()`、`commit()` 与 `revalidateResumedSave()` 联合执行，验证命中测试期间存档被替换、成功操作、引擎拒绝、无效落点。既有拖拽专项测试的 mock `commit` 改为求值传入的动作函数，确保仍覆盖实际引擎调用次数与延迟点击保护。完整 Node 回归、静态安全/部署隔离、完整 Git 历史密钥扫描以**最终 HEAD SHA** 的 GitHub Actions 为准。

## 剩余风险及发布边界
这只是同步 CAS 路径的动作求值时序收敛，**并未**把普通模式页面切换为统一 Web Locks 原子写入。计时器、启动迁移、重置仍在同步写入路径，未来切换必须全写入者一起协调；旧版未协调标签仍可在最后一次读回之后写入。尚无真实 iPhone Safari、微信 WebView、跨标签端到端、真实 PostgreSQL/Edge 验收。

PR #58 和关联研发 PR 保持 Open/Draft；不合并 main、不调整正式导航或部署白名单、不发布 Pages/Cloudflare/Edge、不运行线上 SQL/迁移、不制作美术或作弊后门。
