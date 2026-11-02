# P34 · 日常经营回声的 DLC 身份隔离（未发布）

## 风险
P30 的 `incidentWorkshopEcho` 只检查 `kind` 和 `id`，当未来 DLC 的独立剧情包合法复用首卷的 `fog`、`visitor` 等局部事件 ID 时，可能错误展示首卷经营回声。P31 的选择回声已经限制首卷对象身份，但经营回声尚未采用同一边界。

## 本轮改动
- 在 `merge/story/incident-context.mjs` 限制六条经营回声只接受 `CORE_STORY_PACK.entries` 中原始事件对象，禁止外部同 ID 事件借用首卷对白。
- `tests/merge-story-incident-context-p30.test.mjs` 对六条事件分别覆盖合法首卷、复制的同 ID DLC 和只有 ID 的伪事件；验证经营状态没有写入。
- 不更改事件哈希、经营数值、存档 schema、工作台或 UI；未接入任何生产服务。

## 验收及遗留风险
自动化：`node --test tests/merge-story-incident-context-p30.test.mjs`、`node --test tests/*.test.mjs scripts/*.test.cjs`、`bash scripts/security-check.sh` 与完整历史密钥扫描；以最终提交对应 CI 三项真实结论为准。

事件对象身份约束适用于当前同一 JS 模块实例的首卷 UI；未来跨 JSON 反序列化或跨 realm 的剧情包若需回声，必须显式传入经审核的 pack ID 和条目来源，不得退回仅按 ID 匹配。iPhone Safari、微信 WebView 和跨标签真机仍未验收。

保持 PR #59 Draft；不合并 main、不发布、不修改部署白名单或导航、不接触线上 Supabase 数据。
