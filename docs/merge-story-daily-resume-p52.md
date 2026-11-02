# 《云屿百物铺》P52 · BFCache 恢复时安全接纳已固定的每日事件（未发布）

## 实际问题
P49–P51 能在写锁结果及 StorageEvent 中识别另一标签写入的字节完全一致每日事件固定记录。但 iPhone Safari 的后台暂停、BFCache 返回等场景可能错过 StorageEvent；页面恢复时只按旧 `raw` 比较，因而将无害的同日固定误判为不可恢复的跨标签冲突。

## 本轮实现
- `merge/story/daily-pin-reconcile.mjs` 增加 `adoptConcurrentDailyPinOnResume`：从存储**重新读取**真实对白存档，只接受由旧有效原始字节基线推导出的、**当天唯一确定的每日事件固定**，要求完整 JSON 序列化字节与读回完全一致；不需要依赖可能丢失的 StorageEvent。
- `merge/story/ui.mjs` 的 `pageshow`/前台恢复路径，仅在**没有正在进行的写入**、恢复检查返回 `WRITE_CONFLICT` 且严格核对成功时更新内存快照和失效 epoch。其他差异、损坏存档、缺失数据及不可读存储均保留原有阻断；恢复时继续关闭旧对白，防止沿用过期工作台条件。
- 与 P50 的被动 StorageEvent 接纳、P51 的主动阅读保持互补；不写入任何存档，不改资源、事件轮换、DLC 或部署路径。
- `tests/merge-story-daily-resume-p52.test.mjs` 新增6项，覆盖安全接纳、主线后续选择、跨日拒绝、恶意/无关更改、存储故障及真实 UI 接线合同。
- 同步上游 P2.61f 的普通模式冲突界面安全清理，保留其原有文件与测试。

## 验证
专项 `node --test tests/merge-story-daily-resume-p52.test.mjs`，完整 Node 测试与 `bash scripts/security-check.sh`、Git 历史密钥扫描以**最终提交 SHA** 的 GitHub Actions 为准。

## 剩余风险
Web Locks 缺失时旧客户端的同步写入仍可能产生非原子 CAS 竞争；普通模式异步持锁尚未全面接入。真实 iPhone Safari、微信 WebView、双标签与 BFCache 真机端到端仍待验证。本轮不得视为发行候选。PR #58/#59 保持 Open/Draft；不合并 main、不发布、不触及线上 Supabase。
