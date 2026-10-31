# 《云屿百物铺》V3 · P2.34 异常 UTF-16 原始存档无损备份（未发布）

## 风险与修复
浏览器 localStorage 保存的是 JavaScript UTF-16 字符串。P2.33 已限制实际 UTF-8 下载字节数，但浏览器 TextEncoder/Blob 遇到**孤立代理项**（如单独的 U+D800）会静默替换为 U+FFFD。直接导出 `.txt` 会破坏原始字符，无法声称无损。

本轮仅增强 `merge/save-export.mjs`：对包含孤立代理项的原始存档，使用 `JSON.stringify({format:'yunyu-normal-raw-utf16-v1',raw})` 构造明确标识的 JSON 封装。JSON.stringify 会将孤立代理项转义为 ASCII `\\ud800` 等形式，`JSON.parse(下载文本).raw` 可以在 JavaScript 中逐 UTF-16 代码单元恢复原始 localStorage 字符串。文件名为 `yunyu-unverified-utf16-escaped.json`，始终 `verified:false`，不会冒充有效 V3 存档。

普通 Unicode 文本（包括合法的表情符号代理对）保持现有原样导出逻辑。封装后的实际 UTF-8 文件长度也必须在 2,000,000 字节以内，否则拒绝导出并保留浏览器原始数据。下载成功仍需用户在设备上核实。

## 专项回归与边界
- `tests/merge-save-export.test.mjs` 验证孤立代理项的精确代码单元往返、合法 Emoji 不封装、封装膨胀超限时拒绝、只读存档以及界面提示。
- 不引入自动恢复或导入，封装文件**不可直接导入**；未来恢复流程必须显式识别 format 并经过原始字符串、V3 模式及冲突校验。
- Node 单测不等于 iPhone Safari / 微信 WebView 的实际文件下载验证；同步 localStorage 仍不能提供跨标签原子事务。
- 不修改 main、正式导航、部署白名单，不合并或发布，不操作线上 Supabase，不制作美术或作弊后门。
- 必须以本次新 HEAD 对应全仓库回归、静态安全与部署隔离、完整 Git 历史密钥扫描三项 GitHub Actions 全部成功才标记工程完成。
