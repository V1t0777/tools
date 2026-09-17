# Security policy

## Supported version

Only the current `main` branch and the live deployments are supported.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for issues that could expose an account, authorization boundary, or non-public data. Do not include passwords, session tokens, database credentials, or other secrets in a public issue.

For ordinary defects that do not involve sensitive information, open a normal GitHub issue.

## Repository rules

- Browser code may contain only public client identifiers. Never commit a Supabase `service_role` key, secret key, database password, Cloudflare API token, personal access token, or user session.
- GitHub Actions must declare `contents: read` at workflow level and pin every external Action to a full commit SHA.
- Changes to `cloudflare-secure/`, `.github/`, or the shared authentication helper require owner review when pull requests are used.
- GitHub Secret Protection and push protection remain enabled.

The automated repository check reports only the rule and file path when it finds a possible secret; it never prints the matching value.
