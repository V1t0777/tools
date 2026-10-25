# 《云屿百物铺》V3 · P2.60a 普通模式写入锁基础（未发布）

## 目标与边界
当前普通模式 `merge/main.mjs` 的同步 `persist()` 已有原始字节 CAS 与写后回读，但两个标签仍可能同时读到同一基线并先后覆盖。本增量**只建立可复用、未接入页面的** Web Locks 独占写入边界，不宣称普通模式已经完成跨标签原子化。

## 实现
- `merge/normal-save-lock.mjs` 暴露独立锁名 `toolbox.merge-isle.normal-save.v3` 与 `commitNormalSnapshotLocked()`，与未来云队列锁、剧情模式存档隔离。
- 获取真正的独占 Web Lock **之后**重新读取 `SAVE_KEY` 原始字节，与调用方明确传入的 `expectedRaw` 精确比较；不同则拒绝，不重算候选经济操作、不自动合并、不允许确认重置覆盖更新。
- 通过后复用 `commitNormalSnapshot()` 的现有合法性、CAS 与写后精确回读；返回原有成功回执。缺失 Web Locks、拒绝授锁、异常或存储不可读均安全阻断；**不使用 localStorage 假锁**。
- 不修改 `merge/main.mjs`、启动迁移、计时器、重置、正式导航、经济、剧情或线上服务。

## 专项回归
`node --test tests/merge-normal-save-lock.test.mjs` 覆盖双标签相同基线争用仅一方成功、无锁阻断、无可信基线、错误授锁、请求拒绝、存储异常、重置 CAS、空键初始化、写后回读失败与剧情键隔离。最终是否通过以**本提交 HEAD** 的三项 GitHub Actions 为准，不能用旧 SHA 或 VM 模拟代替实机。

## 下一步必须完成
下一阶段需要把普通模式启动写入/迁移备份、玩家动作、后台恢复后的计时器及确认重置**统一迁入同一锁边界**；UI 在异步等待期间必须禁用旧操作并重新核对存档，异常备份也应在锁内确认，不能让未锁定写入口绕过。所有参与标签须使用相同锁名；不支持 Web Locks 的浏览器应只读/阻断写入。Web Locks 只保护同源合作标签，不能防浏览器崩溃丢盘或非合作脚本写入。

## 发布限制
PR #58/#59 必须保持 Open/Draft；不合并 main，不改正式导航或部署白名单，不部署 Pages/Cloudflare/Edge，不执行线上 Supabase SQL/迁移，不制作美术或作弊后门。此增量不是 RC。
