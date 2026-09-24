# tools

朋友互动工具箱。

## Deployment boundaries

- GitHub Pages publishes only the allowlisted, no-auth artifact produced by `scripts/build-public.sh`.
- Cloudflare Pages publishes Supabase-aware pages from the allowlisted artifact produced by `cloudflare-secure/build.sh`.
- Database migrations, Edge Functions, tests, scripts, documentation, and authenticated source pages remain in the repository but are never copied into the GitHub Pages artifact.

Before enabling the deployment workflow, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. The workflow in `.github/workflows/pages.yml` then deploys `dist-public`; do not switch the source back to the repository root.

Run the repository security gate on Linux or CI with:

```sh
bash scripts/security-check.sh
```
