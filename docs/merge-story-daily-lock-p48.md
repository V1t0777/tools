# 《云屿百物铺》P48 · 跨午夜持锁事件固定与后台主线日期刷新（仅 Draft）

## 发现并修复的真实问题

P47 将每日事件固定在剧情存档中，但 `refreshIncidentDay()` 在主线/人物支线标签下跨午夜时**只更新日期、不重新渲染**。玩家留在主线标签、跨午夜后推进章节，可能直到下一次渲染才固定新日事件，使候选集改变。现在无论当前标签是哪一个，日期变化都触发重新渲染，并在已有锁内存档流程固定新日事件。

第二个问题是午夜前发起的自动固定请求如果等待 Web Lock 到午夜后，旧日期校验会正确拒绝写入，但通用 `save()` 将**所有拒绝**视为存档冲突，导致未发生任何写入时也永久阻断本标签。现在仅在以下条件**全部**满足时把这次失败视为无害取消：明确属于自动事件固定；日期已经变化；锁操作正常返回 `value=false`；页面存储世代未改变且原本未被阻断；重新读取的存档有效，且原始字节与操作前完全一致。随后在 `pinQueued` 清理后重新渲染以固定新日期。任意真实并发冲突、存储损坏、锁 API 异常、字节变化仍保持 fail-closed，不静默重载或覆盖他人进度。

## 改动与验证

- `merge/story/ui.mjs`：跨日刷新覆盖全部标签；自动固定操作新增可识别的 `pinDay` 取消条件；异步队列退出时确保新日固定不会因 `pinQueued` 标志被遗漏。
- `tests/merge-story-daily-lock-p48.test.mjs`：真实 `saveStoryDialogueWithLock` 事务的双标签同基线竞争、跨午夜锁等待、与主线提交冲突、锁及存储异常、跨日标记更新和 UI 失败边界合同。
- 调整 P24/P46/P47 既有 UI 合同测试以匹配新的安全签名和跨日行为。
- 未改变故事包、存档版本、奖励、经济资源、正式导航、部署白名单或任何后端。

## 门禁与风险

专项：`node --test tests/merge-story-daily-lock-p48.test.mjs tests/merge-story-daily-pin-p47.test.mjs tests/merge-story-daily-boundary-p46.test.mjs tests/merge-story-web-lock-dialogue-p24.test.mjs`。还需全仓库 Node、`bash scripts/security-check.sh` 和完整历史密钥扫描，以本轮提交 SHA 的 CI 为准。

本轮只修复自动固定的无害**日期过期**取消；两个标签真正争抢同一天首次固定时，输掉的标签仍因原始字节冲突进入只读阻断，避免无证据地自动合并存档。Web Locks 缺失时仍只能使用非原子的 CAS fallback；旧版本标签及真机 Safari/微信 WebView、BFCache、时区突变仍需专项实测。普通模式持锁接入也未完成。CI 不能代替真机或发行验收。

保持 PR #59/#58 Open/Draft，禁止修改/合并 main、发布 Pages/Cloudflare/Edge、改正式导航或部署白名单、执行线上 Supabase 操作或制作作弊后门。
