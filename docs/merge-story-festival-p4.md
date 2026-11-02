# 剧情经营 P4：第四章开张庆典与门面修整（未发布）

## 剧情 → 经营 → 剧情
- 第三章《海雾里的灯》（`harbor-light`）必须先读完，才能在剧情专属工作台点击“修整百物铺门面”。
- 复用现有 V3 引擎 `upgradeBuilding(state,'storefront')`：2 级、60 金币、一次性真实扣费；只有 `buildings.storefront===1` 才解锁第四章《大家的开张庆典》（`festival`）。
- 第四章末《写信的人》依然必须先阅读庆典；既有旧存档的已读章节不会倒退。
- 花园、港湾此前的主线门禁与真实建筑不变；人物支线非强制；普通经营独立金币、建筑、物品和存档不受影响。

## 内容与经济注意事项
- “修整门面”不是大规模节庆系统；美术资源、庆典人群、氛围动画和声音尚未制作。
- 不新增金币、活动掉落、免费奖励，也不跨故事和经营模式共享资源。
- 现有引擎在店面建设后提升后续订单金币；这属于既有经济规则，本阶段只进行调用。
- 尚未测算第三章完成到第四章建设的实际玩家时间，可能需根据模拟和 iPhone 真机体验调整节奏。
- 需要覆盖异步标签并发、Safari 存储限制、返回页刷新与缓存，CI 不代替设备验收。

## 验证
- `node --test tests/merge-story-workshop.test.mjs`
- `node --test tests/*.test.mjs scripts/*.test.cjs`
- `bash scripts/security-check.sh` 及 Git 全历史密钥扫描。

不得修改 main、部署 GitHub Pages/Cloudflare/Edge、执行线上数据库 SQL/迁移或改变正式部署白名单。PR #59 必须保留 Draft。
