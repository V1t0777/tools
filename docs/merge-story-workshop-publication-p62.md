# P62 · 剧情工作台锁释放后的成功回执保护（未发布）

## 风险与改动
P26 已在共享 Web Lock 内重新核对剧情建筑前置与剧情工作台的 exact-raw CAS，但写入读回成功后锁会释放。另一标签页仍可能在 UI 展示“成功”之前更新工作台，使页面继续使用过期棋盘或展示误导性回执。

1. 新增只读 `verifyStoryWorkshopPublication`：校验写入后原始字节、外部存储事件代数；即使数据恢复到相同字节，事件代数发生变化也拒绝展示旧结果。
2. 花园、港湾和门面建设额外核对原剧情进度原始字节；非建筑经营动作不因无关剧情更新而被错误阻断。存储不可读、剧情损坏和跨标签替换均 fail closed，不覆盖或修复任何存档。
3. 工作台在 Web Lock 返回后、UI 渲染后各执行一次只读复核，异常时停止后续操作并提示重新打开核对。新增 P62 故障注入与 UI 接线回归。

## 验证与边界
专项：`node --test tests/merge-story-workshop-publication-p62.test.mjs`。完整 Node 回归、`bash scripts/security-check.sh` 与全历史密钥扫描以对应 SHA 的 GitHub Actions 为准。当前环境没有仓库本地检出，不声称运行本机全仓库测试。

这是缩小陈旧成功提示窗口的防护，**不是** localStorage 原子跨标签 CAS，也无法在写入后回滚已成功扣费的建设；Safari/微信 WebView 多标签与后台恢复仍需真机验证。独立剧情/普通经营存档仍隔离。不得修改 main、正式导航、部署名单、Pages/Cloudflare/Edge 或线上 Supabase；Draft PR #59 不可转 Ready。
