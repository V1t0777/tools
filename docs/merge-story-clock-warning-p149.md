# P149｜设备时间回拨时的剧情工作台提示一致性（2026-10-30）

## 修复动机
P148 已能识别存档时间戳晚于当前设备时间的体力/工坊异常，但工作台原先将引擎失败消息与诊断消息拼接，可能同时显示“冷却中，剩余 90 秒”和“设备时间回拨”，让玩家误以为需要一直等待。

## 本轮变更
- 仅当诊断为 `CLOCK_BEHIND_ENERGY` 或 `CLOCK_BEHIND_COOLDOWN` 时，使用完整的校时/保档提示替换引擎的普通失败文案；其他经营失败文案和满盘解堵建议保持原样。
- 添加真实剧情工作台 DOM 事件夹具回归：BFCache 返回后点击生产器，识别体力时间异常；全部工坊异常冷却时不展示误导性倒计时。
- 两条路径均断言：无工作台写入、无道具消耗、普通经营及剧情对白存档原样保留。

## 自动化与真机边界
专项：`node --test tests/merge-story-warehouse-upgrade-p145.test.mjs tests/merge-story-resource-recovery.test.mjs`。
全量：`node --test tests/*.test.mjs`；`bash scripts/security-check.sh`；完整 Git 历史密钥扫描以该 SHA 的 GitHub Actions 为准。CI 未完成或失败不得称通过。

仍需 iPhone Safari、微信 WebView 实机验证后台恢复、系统自动校时与真实触控。不要为模拟异常在用户日常手机上随意修改系统时钟；优先用隔离测试设备。此次不更改计时规则、存档协议、普通模式、部署配置或生产数据，不发布。
