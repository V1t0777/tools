# 《云屿百物铺》V3.1 · P2.65d 后台页面写入隔离与 BFCache 恢复

**范围：普通模式独立 Draft 研发分支；未发布。**

## 缺陷与影响

浏览器可能先发出 `pagehide`，稍后才设置 `document.hidden`。此前页面调用运行时 `invalidate()`，但没有待执行事务时仍保持 `ready`；随后排队的点击、计时器或确认重置可能重新开始持锁写入。Web Locks 保证并发互斥，不能代替页面生命周期授权。确认对话框期间切换页面也存在同类窗口。

## 同一主题工程闭环

1. `normal-page-lifecycle.mjs`：新增只读 `suspended`，区分 pagehide 和 visibility 隐藏；pagehide 后 focus 不能擅自恢复，必须在可见的 pageshow 中成功核验存档。单纯隐藏则在可见时同步核验后恢复；损坏/冲突仍阻断。
2. `main-locked.mjs`：普通动作、棋盘预检、计时器、确认重置共用后台门禁。确认弹窗返回后再次检查，避免确认期间离开却重置。后台只拒绝新写入，不回滚可能已提交的旧事务。
3. 两项生命周期测试和三项实际页面 DOM 模拟测试覆盖 pagehide 无 hidden、focus、pageshow、确认期间离开、visibility 恢复，以及原始存档与写入计数。

## 验证与边界

全仓库 Node、`bash scripts/security-check.sh`、完整 Git 历史密钥扫描必须以本提交对应的真实 GitHub Actions 为准。Node DOM 模拟不等于真实 Safari/微信 WebView；仍需实机 BFCache 事件顺序、双标签、下载落盘验收。未接入云端、未修改正式导航/部署白名单、经济数值、剧情存档或线上 Supabase；PR #58/#59 保持 Open/Draft，不合并、不发布。
