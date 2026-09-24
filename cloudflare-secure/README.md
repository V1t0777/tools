# Cloudflare Pages 安全镜像

此目录用于把会加载 Supabase 会话的页面部署为独立 Cloudflare Pages 安全站点。GitHub Pages 只发布不加载登录态的白名单页面。

## Cloudflare Pages 配置

- Repository: `V1t0777/tools`
- Production branch: `main`
- Framework preset: `None`
- Root directory: 留空（仓库根目录）
- Build command: `bash cloudflare-secure/build.sh`
- Build output directory: `dist-secure`
- Environment variables: 当前不需要

构建脚本只复制：

- `dinner/`
- `night-shift/`
- `admin-night-shift/`
- `flappy/`
- `games/`
- `pictionary/`
- `shared/toolbox-auth.js`
- 本地固定版本的 Supabase Realtime SDK
- `holidays/*.json`
- 安全镜像首页、`_headers` 与 `robots.txt`

不会复制电子木鱼、生日倒计时、抛硬币等无需登录的公开工具，也不会复制数据库迁移、Edge Functions、测试、脚本或内部文档。

## 测试阶段原则

1. 不迁移或复制 Supabase 数据库。
2. Cloudflare Pages 使用系统分配的 `pages.dev` 地址先测试。
3. GitHub Pages 主站只保留无需登录的工具和指向安全站点的固定链接。
4. 中国大陆网络连续测试后再决定是否切换自定义域名。

## 安全说明

`_headers` 为 Cloudflare Pages 添加 CSP、禁止 iframe 嵌入、MIME sniffing 防护、Referrer Policy 和 Permissions Policy。安全站点不加载第三方分析脚本。现有页面仍包含少量内联脚本/样式，因此 CSP 暂时保留 `'unsafe-inline'` 兼容项；后续若把内联代码拆成独立文件，可以进一步收紧 CSP。

前端只使用 Supabase publishable key；不要在此仓库加入 `service_role`、secret key、数据库密码或其他服务器端密钥。
