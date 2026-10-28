# 云屿 V3.1 P2.65ao｜原生导入取消后常驻按钮旧触控保护（未发布）

## 发行阻塞与修复
普通模式的动态订单、仓库物品、商店按钮已经绑定 renderGeneration，棋盘也会吞掉导入期间的旧触控；但「仓库扩容」「收纳选中」「确认重置」是不会随 render() 重建的常驻按钮。若移动 WebView 在原生文件选择器期间发出 pointerdown，用户随后取消导入，迟到的兼容 click 仍可能触发扩容金币扣费，或打开重置确认框。此前 commit()/reset() 的 importPending 检查只能阻止**仍在导入时**的操作，无法识别**取消后才到达**的旧点击。

为上述三个常驻写入入口增加统一的 chooser-era 指针许可：导入期间 pointerdown 记录旧触控，后续非键盘 click 仅消费、不执行；新的 pointerdown 可重新授权，detail=0 的键盘激活不被误吞。pointercancel 同样撤销旧点击。现有 Web Locks、存档原始字节核验、运行时单飞、重置双重确认均保持不变。

## 回归与范围
新增两个实际普通模式 HTML 入口 Node DOM 故障注入：导入选择器期间按下仓库扩容、取消后迟到 click 不得扣费；导入期间按下重置、取消后迟到 click 不得弹确认。两项都验证原始普通存档零意外写入、剧情存档不变，并验证新指针操作可恢复正常功能。

专项命令：`node --test tests/merge-locked-page-dom.test.mjs`。全仓库 Node、`bash scripts/security-check.sh`、部署隔离和完整 Git 历史密钥扫描必须以本提交 SHA 的真实 GitHub Actions 结果为准；未全绿不得宣称完成。

## 剩余风险与发行边界
Node DOM 夹具无法证明 iPhone Safari/微信 WebView 的真实 pointer/click 事件顺序或文件下载落盘；Web Locks 也不能让 localStorage 跨标签自动原子化。仍需双标签、BFCache、导入/导出/重置连续真机回归及长期经济压力模拟。PR #58/#59 继续 Open/Draft；不修改 main、剧情源文件、正式导航、部署白名单或线上 Supabase；不发布任何 Pages/Cloudflare/Edge。
