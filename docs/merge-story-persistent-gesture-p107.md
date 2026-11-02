# 云屿剧情 P107｜常驻按钮 BFCache 旧触控许可撤销（未发布）

## 真实风险与处理
剧情工作台的重置、异常原文导出、仓库收纳、三处建设按钮和首卷下一步导航都是常驻 DOM 元素，不会随 render() 重新绑定。若 pointerdown 发生在 pagehide/隐藏/跨标签刷新之前，返回后迟到的兼容 click 可能再次发起原生确认或旧导航。为这七处入口增加 pointerdown 代次许可、pointercancel 撤销、click 前复核；使用 lifecycleEpoch、storageEpoch 和 renderGeneration 的联合代次，过期触控取消并提示重新按下。键盘 detail=0 仍视为新的明确操作。

## 专项验证
扩充 `tests/merge-story-workshop-lifecycle-p70.test.mjs` 的真实入口 DOM 故障注入：BFCache 前按下重置、返回后迟到 click 必须不弹确认/不写入；新触控允许正常确认；pointercancel 拒绝迟到 click 而键盘可用；损坏备份导出及导航拒绝旧触控；剧情存档刷新使旧重置许可失效。核对剧情对白、普通模式原始存档不被误写。专项命令：`node --test tests/merge-story-workshop-lifecycle-p70.test.mjs`。全仓库 Node、`bash scripts/security-check.sh`、部署隔离及完整 Git 历史扫描以本次最终 SHA 的 Actions 为准。

## 上游同步及边界
安全并入 PR #58 的 P2.65ap 常驻按钮旧指针修复；同步前比较共同祖先和重叠文件 Blob SHA，剧情侧对这两个上游文件没有独立修改。双父合并不强推。此次未改变剧情章节、经济数值、存档结构、正式导航、Cloudflare 部署白名单或线上数据。DOM 故障注入不等于真实 iPhone Safari/微信 WebView 的 BFCache、原生确认或文件下载落盘；localStorage 也没有跨标签原子事务保证。PR #58/#59 继续 Open/Draft，禁止合并 main、部署或发布，11 月 10 日目标以实证门禁决定。
