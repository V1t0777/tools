# Privacy hardening deployment (2026-10-08)

## Changes already applied

- Production Supabase migration `20261008023746_privacy_member_access_and_audit_minimization` restricts `authenticated` SELECT access on `public.members` to `id, nickname, color`. RLS membership/application policies are retained. Server Edge Functions continue to resolve `user_id` through privileged server-only Supabase access.
- Private access change triggers now capture ONLY allowlisted authorization fields (`user_id`, `app_code`, `role`) rather than the complete row JSON document. This applies to new audit records, not a retroactive rewrite of logs.
- Database cron job `toolbox-privacy-access-audit-retention` prunes access audit records older than 180 days daily. It intentionally does not touch staff/shift/dinner/user records, games, or backups.
- Shared browser authentication notifies other same-origin tabs only of `SIGNED_IN`/`SIGNED_OUT`, no longer sends session tokens through BroadcastChannel. The existing localStorage-backed session is retained to avoid breaking mobile refresh/cross-tab login. It remains vulnerable to a fully privileged same-origin XSS; CSP and script allowlists remain important.
- Four Supabase game Edge Functions use redacted error logs (error codes/status only), preserve intentionally thrown user-facing validation errors, and return generic `INTERNAL_ERROR` instead of raw infrastructure exception messages.
- `scripts/privacy-scan.mjs` blocks identifiable account emails, phone-like literals, and direct personnel seed rows from new public SQL/catalog snapshots. This is invoked in the repository security gate, including pull-request CI.
- Updated migration manifest, schema-grant catalog and rebuild companion with the real production state. All migrations remain versioned in `supabase/migrations/`.

## Known remaining limitations

1. **Git history still has old personal-data literals.** Removing current source does NOT remove historic commits, forks, cached copies, PR diffs, GitHub Actions artifacts, or previous clones. The connected GitHub workflow only supports normal commit/PR changes; no history rewrite was performed. Perform a *separate, backup-backed*, carefully coordinated `git-filter-repo`/BFG rewrite, verify all old refs and tags, then force-push only during a maintenance window after reviewing branch-protection, deployment dependencies and collaboration impact. Notify collaborators to re-clone, inspect artifact retention and public mirrors. Prefer replacing or invalidating any associated authentication credentials if any were exposed. Rewrite must not be represented as guaranteeing erasure from public caches.
2. **Supabase Auth leaked-password protection still needs to be enabled in the dashboard.** It is an Auth service configuration, not a Postgres migration or an API setting exposed by the current connector. Review `https://supabase.com/dashboard/project/tmxpueakxibsaakdyusn/auth/providers` and Auth security settings, and enable it where plan permits. Supabase documents that leaked-password protection requires Pro or higher. Enforce stronger passwords and MFA for administrators through supported Auth methods without silently changing existing user accounts.
3. **Cloudflare Pages secure frontend deployment** is a separate deployment pipeline. GitHub commit/Pages action is not conclusive proof of live Cloudflare secure mirror deployment; verify the actual deployed `shared/toolbox-auth.js` and game clients on the authenticated origin.
4. **Browser localStorage still retains access and refresh tokens.** The cross-tab message hardening lowers one exposure surface but cannot replace a server-side HttpOnly cookie authentication gateway without architectural changes. Do not claim tokens are immune to XSS.
5. **Log visibility and retention** at Supabase, Cloudflare, GitHub Actions and client-side consoles are separate. The present application redaction does not retroactively erase older provider logs; provider-level access and retention should be configured separately.
6. **Database RLS** limits rows but permitted roster/night-shift staff nicknames and dates are still real personal information for authorized users. Avoid using production rows for demos, snapshots or tests. Any anonymized test database should use invented people, not reversible name replacement.
7. **No automatic deletion of shift, staff, dinner or user history** was introduced. Define a legally/operationally appropriate retention period and data-subject deletion procedure with the data controller before any destructive cleanup, particularly for workplace records.

## Verification and rollback

- Run `node --test tests/*.test.mjs scripts/*.test.cjs`, `node scripts/privacy-scan.mjs`, and `bash scripts/security-check.sh`.
- Verify an authenticated role can `SELECT id,nickname,color` from `public.members` but lacks `user_id` access; verify guest/invalid JWT cannot retrieve any roster member or schedule rows.
- Check function `private.log_access_change()` source references only approved keys and the `toolbox-privacy-access-audit-retention` cron job exists. Verify no unrelated cron jobs were modified.
- A frontend rollback is a git revert via CI. Database changes require a **new forward migration**, not historical migration deletion. For a controlled rollback, reinstate prior grants only after security approval, and disable the audit cleanup job if retention changes.
- Preserve an encrypted off-repository data backup. Schema and migration source alone cannot recover credentials or records.
