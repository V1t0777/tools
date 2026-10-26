# P55 · 剧情分支安全 CI 与 Cloudflare 部署隔离（未发布）

- 独立剧情分支 push 直接运行既有 `Security checks` 三项任务；不触发 `pages.yml` 的部署任务（该任务仍仅监听 main）。
- Cloudflare Pages 的 Git 集成**不受 GitHub Actions 工作流限制**：代码提交必须以前缀 `[CF-Pages-Skip]` 开头，Cloudflare 官方文档说明会跳过对应部署。该前缀是提交级保护，**不能替代** Cloudflare 项目级分支控制。
- 正式长期隔离：在 Cloudflare 控制台 > Workers & Pages > `zhao-toolbox-secure` > Settings > Builds > Branch control，预览分支设为 None，或在 Custom branches 排除剧情和上游研发分支，保存并核验；生产分支保持 main，不调整生产自动部署选项。
- 在项目级设置确认前，不得进行未带跳过部署前缀的研发提交，不重新打开 PR #60 去触发 CI，也不得把 CI 绿灯冒称真机或发行验收。
- 本次提交仅更新安全 CI 范围、回归断言和研发说明，未修改页面、正式导航、构建白名单、Supabase 或 Cloudflare 在线设置。
