# Disaster Recovery Runbook

Last reviewed: 2026-09-18

## Architecture and recovery sources

- **Source code:** GitHub repository history on `main`.
- **Public site:** GitHub Pages.
- **Authenticated mirror:** Cloudflare Pages, built from `main` with `bash cloudflare-secure/build.sh`, output directory `dist-secure`.
- **Application data and authentication:** Supabase.
- **Fallback:** the original authenticated-page copies remain in the GitHub Pages repository so navigation can be switched back quickly if Cloudflare access is degraded.

No server secret is required to build the static sites.

## Incident: bad frontend deployment

1. Identify the last known-good Git commit.
2. Revert the faulty commit rather than force-resetting shared history.
3. Push the revert to `main`.
4. Confirm both GitHub Pages and Cloudflare Pages complete their automatic deployments.
5. Test the root navigation plus `/dinner/`, `/night-shift/`, and `/admin-night-shift/`.

## Incident: Cloudflare Pages outage or poor mainland reachability

Keep Supabase unchanged.

Change only the three protected-page links in the GitHub root `index.html` back to the local repository paths:

- `./dinner/`
- `./night-shift/`
- `./admin-night-shift/`

This is an application-routing rollback, not a database rollback.

## Incident: credential exposure

1. Determine exactly which credential was exposed.
2. Revoke or rotate the compromised credential at its provider.
3. Remove it from the current repository and deployment configuration.
4. Assume a committed secret remains recoverable from Git history; rotate it even after deleting the visible line.
5. Review Supabase sessions and authorization state if an authentication-related credential was involved.
6. Re-run the repository security workflow and the Supabase Security Advisor.

A browser publishable key is not equivalent to a server secret; the important boundary is correct database grants and RLS. A `service_role` key or database password must never be used in frontend code.

## Supabase backup and restore

Supabase plan features determine automated backup retention. Current Supabase documentation states that Pro, Team, and Enterprise projects receive scheduled daily backups, while Free projects should create regular off-site logical dumps. PITR is a separate paid add-on on eligible plans.

For this toolbox:

- Keep at least one backup copy outside the Supabase project itself.
- Treat project deletion as irreversible; provider-hosted backups disappear with the project.
- Database backup does not restore deleted Storage objects, so back up Storage separately if Storage is introduced later.
- Schedule any restore for a maintenance window because the project is unavailable during restoration.
- After a restore, test authentication, RLS-protected reads/writes, shared dinner state, personal night-shift writes, and department-roster access before declaring recovery complete.

## Schema-recovery gap

The managed Supabase database currently has migration history, but the full SQL migration source is not yet versioned in this public repository. That means GitHub alone is **not** a complete database rebuild source.

Do not solve this by committing a raw database dump: dumps can contain user data, allowlists, authentication data, or credentials. The safer follow-up is to maintain reviewed, data-free schema migrations and keep any data-bearing backups encrypted and off-repository.

## Recovery verification checklist

A recovery is complete only after all of the following succeed:

- GitHub root navigation loads.
- Public tools still load from GitHub Pages.
- Protected navigation reaches the Cloudflare Pages origin.
- Existing users can authenticate.
- Unauthorized accounts remain blocked.
- Dinner shared data can be read and updated according to membership.
- Night-shift users can read shared shifts and modify only permitted records.
- Department-roster viewer/admin behavior matches the intended role.
- Cloudflare security headers are present.
- Supabase Security Advisor has no newly introduced critical findings.
