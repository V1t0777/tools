# Cloudflare Pages 安全镜像

此目录用于把需要 Supabase 登录的页面部署为独立 Cloudflare Pages 镜像，同时保留现有 GitHub Pages 主站不变。

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
- `shared/toolbox-auth.js`
- `holidays/*.json`
- 安全镜像首页、`_headers` 与 `robots.txt`

不会复制电子木鱼、生日倒计时、抛硬币等无需登录的公开工具。

## 测试阶段原则

1. 不修改 GitHub Pages 主站 URL。
2. 不删除 GitHub Pages。
3. 不迁移或复制 Supabase 数据库。
4. Cloudflare Pages 使用系统分配的 `pages.dev` 地址先测试。
5. 中国大陆网络连续测试后再决定是否切换自定义域名。
6. 如果访问体验变差，直接继续使用原 GitHub Pages 地址即可，不需要数据库回滚。

## 安全说明

`_headers` 为 Cloudflare Pages 添加 CSP、禁止 iframe 嵌入、MIME sniffing 防护、Referrer Policy 和 Permissions Policy。现有页面仍包含少量内联脚本/样式，因此 CSP 暂时保留 `'unsafe-inline'` 兼容项；后续若把内联代码拆成独立文件，可以进一步收紧 CSP。

前端只使用 Supabase publishable key；不要在此仓库加入 `service_role`、secret key、数据库密码或其他服务器端密钥。
