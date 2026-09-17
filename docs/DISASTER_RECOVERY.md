# Backup and disaster recovery

This site has two independent delivery paths:

- GitHub Pages publishes `main` from the repository root.
- Cloudflare Pages builds the authenticated mirror with `bash cloudflare-secure/build.sh` and publishes `dist-secure`.

Supabase contains application data. The repository backup described here does not replace a Supabase database backup.

## Automated repository backup

The `Verified repository backup` workflow runs every Sunday and can also be run manually. It creates a complete Git bundle, verifies it, records a SHA-256 checksum, and retains the artifact for 90 days. The workflow has read-only repository permission and uses no repository secret.

At least once per quarter, download the newest artifact and copy it to storage outside GitHub. An artifact stored only in the same GitHub account is not a complete account-loss backup.

## Quarterly restore drill

1. Download `tools.bundle` and `tools.bundle.sha256` from the newest successful backup run.
2. Verify the checksum with `sha256sum -c tools.bundle.sha256`.
3. Verify the bundle with `git bundle verify tools.bundle`.
4. Restore into an empty directory with `git clone tools.bundle tools-restored`.
5. In the restored directory, run:

   ```sh
   bash cloudflare-secure/build.sh
   python3 scripts/security_check.py . --dist dist-secure
   ```

6. Confirm that the restored commit matches the intended production commit. Do not repoint either production deployment during a drill.

## GitHub Pages recovery

1. Restore the repository and `main` branch from a verified bundle.
2. In repository Settings → Pages, select **Deploy from a branch**, `main`, and `/(root)`.
3. Confirm that the Pages workflow succeeds and that `https://v1t0777.github.io/tools/` returns HTTP 200.

## Cloudflare Pages recovery

1. Connect the restored repository to a Pages project.
2. Use build command `bash cloudflare-secure/build.sh` and output directory `dist-secure`.
3. Do not add server-side Supabase or Cloudflare secrets to the static build.
4. Verify the home page plus `/dinner/`, `/night-shift/`, and `/admin-night-shift/`. Confirm CSP, frame protection, and `nosniff` headers.
5. Change the three links on the GitHub Pages home page only after the mirror is healthy. Keeping the old GitHub-hosted copies allows a fast link-only rollback.

## Supabase recovery boundary

Supabase recovery is a separate operation. Keep database backups, schema/RLS definitions, and recovery credentials outside this public repository. After a database restore, validate RLS with a least-privileged test account before reconnecting production pages.
