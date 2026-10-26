# 《云屿百物铺》剧情 P63 · 重置后双阶段发布复核（研发分支）

状态：仅 Draft PR #59 / 剧情独立开发分支；不合并、不发布、不操作生产数据库。

## 问题与实现

此前剧情工作台的普通经营动作已在 Web Lock 释放后与界面渲染后双次验证本地原始字节，但**明确确认的工作台重置**仅检查锁回调成功和 storageEpoch。另一个标签页若在重置写入成功之后、锁释放之后覆盖了存档，当前页面仍可能显示“重置完成”的状态，误导玩家重复操作。

本轮复用既有只读 verifyStoryWorkshopPublication：先保留原先的确认、锁内 CAS、重置 revision 单调递增和事件 epoch 条件；锁释放后必须复核 reset 返回的新存档原始字节与 epoch，成功才替换页面 state/raw；渲染完成后再做第二次只读复核。若有其他标签页覆盖、storage clear、ABA 事件或存储不可访问，页面进入阻断态，不自动重置、不覆盖证据，提示先重新打开并核对金币、建筑、订单。此行为不会回滚已提交的重置。

## 验证范围

- tests/merge-story-workshop-reset-publication-p63.test.mjs：成功复核不额外写盘、锁释放后他标签覆盖、ABA 事件、锁释放后读失败、UI 双阶段顺序与危险 API 缺席。
- 既有 P23/P25/P62 与全仓库 Node 测试继续作为回归门禁；GitHub Actions 静态安全/部署隔离和完整历史密钥扫描必须全部成功。当前执行环境不能本地克隆仓库，不能声称本地运行 bash scripts/security-check.sh；CI 需以最终 SHA 核对。
- 需在 iPhone Safari、微信 WebView、后台 BFCache 与双标签手动验证：重置后切标签修改，旧页必须阻断；没有 Web Locks 的环境仍是非原子 CAS；真实设备验证未完成。

## 不变量与发行限制

只修改剧情工作台 UI、专项测试和研发文档；剧情对白、普通经营存档键、数值、正式导航、部署白名单、Cloudflare/Pages/Edge、Supabase 均不改动。Web Locks 只能协调主动参与的同源标签；localStorage 非跨标签原子事务。提交继续使用 [CF-Pages-Skip] 前缀。PR #58/#59 仍保持 Draft，不得将自动化测试视为真机或发行验收。
