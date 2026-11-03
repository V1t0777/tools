# 《云屿百物铺》P2.14 — 剧情内容包可用性预检（只读）

## 已实现的研发增量

新增 merge/story-pack-preflight.mjs 的 previewStoryPackAvailability(progress, installedPackIds)：纯内存比较剧情存档中已经登记的内容包与本次可用的内容包 ID。复用 P2.12 validateStoryProgress 校验剧情存档及包名语法，最多接受 24 个无重复包名。非法、重复、超限包名及普通/混合/损坏存档会被拒绝。

输出冻结且确定性的报告，不持有输入可变引用，也不修改存档、剧情章节或安装清单。报告字段：
- available：有已保存进度且当前可用的包。
- missing：有历史进度但当前缺失的包；不自动清除主线、支线、突发事件、选择、旗标或检查点。
- unregistered：当前有内容但尚未登记剧情进度的包；不自动写入存档。
- activePackAvailable：活动包是否可用；没有活动包时为 null。
- sourceRevision、savedPackCount、installedPackCount：只读诊断；requiresAttention 表示历史包缺失，不等于存档损坏。

## 双模式、DLC 和长期叙事

普通模式保留现有 V3 存档键、金币、体力、背包、工坊、经营里程碑和普通玩法；剧情模式仅使用独立的 P2.12 故事包进度。缺少 DLC 时必须保留历史抉择和已完成的支线，不能因为临时未加载而重置进度。首版剧情不固定最终章、世界真相或 DLC 清单。

本预检只比较包 ID，不能证明 DLC 文件签名、内容版本兼容、脚本可信、节点存在、剧情迁移可行或跨设备一致性。后续需分别设计内容清单、版本迁移、授权和冲突处理；不允许通过静态网页暗码伪造资源或绕过服务端校验。

## 测试与未完成范围

新增 tests/merge-story-pack-preflight.test.mjs，覆盖确定性、冻结输出、输入不变、缺失 DLC/活动 DLC、保存检查点、新包提示、空存档、非法与重复 ID、数量上限、普通/混合/损坏存档拒绝、未接入主界面。该模块未在 merge/main.mjs 激活；未接入 UI、存储写入、云端、发奖或部署。

每次提交必须核对最新 SHA 的全仓库回归、静态安全与部署隔离、完整 Git 历史密钥扫描。代码契约测试不代表 Windows/iPhone 实机体验、DLC 正式兼容或生产云存档验收。

仅在 feat/merge-isle-p0-p1 / Draft PR #58 研发；不修改 main、不合并、不发布 Pages/Cloudflare/Edge、不改正式导航或部署白名单、不执行线上 Supabase SQL/迁移、不制作美术、不实现作弊后门。
