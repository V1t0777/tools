# tools

朋友互动工具箱。

## Deployment

- GitHub Pages: `main` branch, repository root
- Cloudflare Pages authenticated mirror: `bash cloudflare-secure/build.sh` with output directory `dist-secure`

The two deployments intentionally remain independent so the GitHub-hosted copies can be used as a fast rollback path.

## Security and recovery

Every change to `main` runs a dependency-free secret/static-site scan and rebuilds the Cloudflare Pages mirror. GitHub Actions use a read-only token and external Actions are pinned to full commit SHAs. Dependabot tracks the pinned Action versions.

See [SECURITY.md](SECURITY.md) for repository rules and [docs/DISASTER_RECOVERY.md](docs/DISASTER_RECOVERY.md) for backup and restore instructions.
