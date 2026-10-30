# P158｜剧情包 ID 与存档协议一致性（2026-10-30，未发布）

## 修复原因

原先剧情包预检仅按正则检查包名、节点和选项 ID；独立存档校验器还会拒绝 `constructor`、`prototype`、`__proto__` 等保留名。未来 DLC 可能“预检通过，实际注册或完成对白时无法保存”，形成误导性卡关。

## 本轮实现

- `merge/story/runtime.mjs`：预检同步拒绝保留包名（含 `dlc.constructor` 分段名称）、节点名和选项名；首卷核心包内容不变。
- `tests/merge-story-pack-ids-p158.test.mjs`：4 组 Node 回归，覆盖合法带点号 DLC、首卷存档隔离、保留包名、节点名、选择名；预检失败不修改输入。
- 不修改故事存档 schema、普通经营、奖励、经济或部署配置；合法的未来 DLC 继续支持。

## 核验与剩余风险

专项：`node --test tests/merge-story-pack-ids-p158.test.mjs`；全量：`node --test tests/*.test.mjs`、`bash scripts/security-check.sh`、完整 Git 历史密钥扫描。以最终 SHA 的 GitHub Actions 三项门禁为准。

此项只是 DLC 存档协议前置保护，不代表新增 DLC 或手机验收。iPhone Safari、微信 WebView、Windows 离线和异常存档下载落盘仍是 P0；普通模式触控超时、跨标签非原子写入和上游 PR #58 同步仍是 P1。PR #59 必须保持 Draft，不合并 main、不发布、不执行线上 SQL。
