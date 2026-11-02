# 云屿剧情 P106｜对白打开阶段的生命周期与双存档复核

- 范围：仅剧情页 `merge/story/ui.mjs` 的对白打开流程，不改变章节、解锁条件、经济、存档结构、普通模式或正式入口。
- 问题：用户点击已解锁的剧情卡片后，读取独立工作台存档期间可能同步发生 `pagehide`、页面隐藏或跨标签剧情存档替换。旧流程继续构造并打开对白，可能在后台恢复过期模态框。
- 处理：在打开前记录页面生命周期和存档事件代次；工作台读取后及展示模态框前再次检查代次与可见性。重新核对剧情原始存档；若发现另一个标签的替换，则取消打开、保护旧页面，要求重新打开核对。
- 验证：`node --test tests/merge-story-dialogue-lifecycle-p78.test.mjs`；完整 `node --test tests/*.test.mjs`、`bash scripts/security-check.sh` 和全历史安全扫描，以最终 SHA 的 GitHub Actions 为准。
- 新增故障注入：读取工作台时触发 `pagehide` 不弹出旧对白；读取时另一个标签替换剧情存档不显示过期剧情；无竞争时仍能打开对白且不写存档。
- 限制：Node DOM 模拟不是 iPhone Safari 或微信 WebView 实测；`localStorage` 无跨标签原子事务。真实设备 BFCache、文件落盘、多标签并发及 Windows 离线首卷四章仍是发行阻塞。保留 Draft，不合并、不部署、不操作生产数据。
