# 剧情经营 P3：港湾街角建设与第三章因果门禁（未发布）

## 具体实现
- 复用现有 `upgradeBuilding(state,'harbor')`：达到 6 级且具备 330 金币，才可在剧情专属工作台修缮港湾街角。
- 先完成第三章主线《第一次独立修理》（`apprentice`），才出现可执行的修缮按钮；点击时再次核验剧情进度，避免使用陈旧页面绕过剧情顺序。
- 第三章《海雾里的灯》（`harbor-light`）在完成真实 `harbor` 建筑升级后才能标记已读；前面的港口/学徒剧情仍可独立阅读。
- 所有经营资源仍只存在剧情专属本地键，不写入普通模式存档。已经完成的旧剧情记录不回滚。
- 第三章主线只要求学徒的安全修理训练，不强制可选支线；不把港湾街角修缮描述成整个港口或航路恢复运营。

## 验收与风险
- `node --test tests/merge-story-workshop.test.mjs`：等级/金币引擎门槛、实际建造、剧情先决条件、损坏存档保护、页面控件结构。
- `node --test tests/*.test.mjs scripts/*.test.cjs` 与 `bash scripts/security-check.sh`：在 GitHub Actions 运行并以最终 SHA 结果为准。
- 目前尚未进行 iPhone Safari/微信 WebView/Windows 真机验收、真实云存档/RLS/Edge 联调，也没有对 6 级/330 金币进行实测玩家时长平衡；需经济模拟及人工试玩。
- 本改动只发生在 Draft PR #59 的独立研发分支，不改变正式导航或部署白名单、不修改 main、不发布、不执行任何线上 SQL/迁移。
