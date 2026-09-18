# Security Policy

This repository hosts a small static toolbox. Public/no-auth pages are served from GitHub Pages, while authenticated pages are mirrored to Cloudflare Pages and use Supabase for authentication, authorization, and data.

## Reporting a security issue

Do **not** open a public issue containing credentials, authentication bypass details, private user data, or proof-of-concept material that could expose the application.

Use a private contact channel with the repository owner. If GitHub Private Vulnerability Reporting is enabled for this repository, prefer that channel.

## Secrets and client keys

- Supabase `service_role`, database passwords, access tokens, private keys, and other server credentials must never be committed or placed in browser code.
- A Supabase publishable key may appear in frontend code when Row Level Security and database grants are the actual security boundary.
- Cloudflare Web Analytics site tokens are not treated as privileged application credentials.
- Local `.env`, certificate/key files, and database dump artifacts are ignored by Git.

## Security controls in this repository

- The Cloudflare secure mirror is built from an allowlist of authenticated pages and their direct dependencies.
- Cloudflare response headers include CSP, anti-framing, MIME sniffing protection, and a restrictive permissions policy.
- GitHub Actions security checks run with read-only repository permissions and without persisted checkout credentials.
- CI scans tracked files for common high-risk secret patterns without printing matching secret values.
- Dependabot monitors GitHub Actions dependencies.

Authorization remains enforced in Supabase (grants, RLS, and session-aware authorization). Frontend visibility checks are only a user-experience layer.
