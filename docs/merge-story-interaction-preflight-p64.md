# 《云屿百物铺》P64 · 剧情工作台迟到跨标签操作预检（未发布）

## 复现与修复

旧页面只在 BFCache/前台恢复或接收到 storage 事件时检测其他标签修改。若另一个标签刚刚写入而本标签尚未收到事件，玩家仍可选中旧棋盘位置，或在旧状态上计算交单、生产、取回及建设操作。已有写锁和精确原文 CAS 能阻断大多数错误提交，但不能避免旧选择及无效结果提示，也无法保证操作入口先检查最新存档。

本轮在剧情工作台增加统一只读 `revalidateWorkshopBeforeInteraction()`：

1. 点击/键盘激活棋盘格子时，在读取旧槽位或选择材料前比较 `STORY_WORKSHOP_KEY` 当前原文字节与本页可信基线。
2. 所有通过 `commit(result)` 提交的生产、合成、交单、仓库收取和建筑操作，在显示结果或进入 Web Lock 之前再次校验。变化、删除、存储不可读均取消本次操作，清空旧选中状态、增加失效 epoch 并停止继续写入，提示重新打开页面核对。
3. 保留已有 Web Lock、写入时 CAS、锁释放后和渲染后复核，不能用只读预检替代原有并发保护。

## 验证与限制

专项：`node --test tests/merge-story-interaction-preflight-p64.test.mjs`；全仓库：`node --test tests/*.test.mjs`；安全：`bash scripts/security-check.sh`。CI 需核对最终 SHA 三项状态，未完成不能声称通过。

此改动只涉及未发布的剧情工作台；不会修改普通模式、金币平衡、DLC 协议或生产数据库。静态接线测试验证预检入口，纯函数测试覆盖同 revision 不同内容、删除、新增、读取失败和普通模式隔离；**尚非真实 iPhone Safari/微信 WebView 事件时序测试**。localStorage 的读写不是跨标签原子事务，读后到锁内 CAS 之间仍可能变化，必须保留后续门禁。

PR #59 必须保持 Draft；不得合并 main、发布 Pages/Cloudflare/Edge、执行线上 SQL/迁移、改正式导航/部署白名单或制作作弊后门。提交必须以 `[CF-Pages-Skip]` 开头；Cloudflare 控制台禁用预览仅有用户确认，不能据此宣称独立验证。
