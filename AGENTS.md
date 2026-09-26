# Repository Guidelines

## Working principles

- Develop the frontend mobile first.
- Preserve existing behavior unless the task explicitly requests a behavior change.
- Prefer small, focused diffs over broad rewrites.
- Prefer the repository's existing HTML, CSS, and vanilla JavaScript architecture.
- Do not introduce a framework, package manager, or dependency without a clear need.
- For Codex Cloud work, prefer a dedicated task branch and pull request instead of modifying `main` directly.

## Security requirements

- Never commit passwords, private keys, GitHub personal access tokens (PATs), Supabase service-role keys, database credentials, `.env` secrets, or any other private credentials.
- Never weaken authentication, Row Level Security (RLS), Content Security Policy (CSP), deployment isolation, or security checks merely to make a feature work.
- Preserve the existing Supabase authentication behavior and the narrowly scoped Realtime behavior.

## Deployment boundaries

- Read `README.md` before changing deployment behavior.
- Preserve the separation between the public GitHub Pages deployment and the Cloudflare secure, Supabase-aware deployment.
- GitHub Pages must continue to publish only the allowlisted, no-auth artifact produced by `scripts/build-public.sh` in `dist-public`.
- Cloudflare must continue to publish the allowlisted secure artifact produced by `cloudflare-secure/build.sh` in `dist-secure`.
- Do not implement application changes directly in generated `dist-public` or `dist-secure` output. Modify the source files and regenerate the appropriate artifact instead.
- Preserve the existing GitHub Actions security and deployment controls, including immutable action references and disabled persisted checkout credentials.

## Validation

Before considering any code-changing task complete, run:

```sh
bash scripts/security-check.sh
```

- If repository-specific Node tests are relevant to the changed area, run the appropriate existing tests as well (for example, the test commands already used by GitHub Actions).
- Do not claim success when required validation fails.
- For UI changes, check mobile layout, dark and light theme compatibility, safe-area behavior, touch targets, overflow, and reduced-motion behavior when applicable.

## Completion report

At the end of every coding task, summarize:

1. Files changed.
2. Behavior changed.
3. Tests and checks run.
4. Remaining risks.
