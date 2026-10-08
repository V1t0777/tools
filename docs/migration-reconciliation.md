# Supabase migration and schema reconciliation (2026-10-08)

## Scope and provenance

- Production project: `tmxpueakxibsaakdyusn`.
- Read-only recovery source: `supabase_migrations.schema_migrations.statements[1]`; 43 applied versions were captured from production.
- `supabase/migrations/` now has exactly one SQL file per applied production version. There are 43 files, of which **40 are byte-for-byte identical** to the applied SQL. The 3 deliberate privacy exceptions are listed below.
- `supabase/migrations-history.manifest.json` records each production version, name, and the SHA-256 digest of the **original applied statement**. The SQL-digest CI regression verifies the 40 unredacted versions.
- The older, incorrectly timestamped files were retired from `main` (Git history retains them) rather than being represented as additional database migrations. No production migration history rows were changed.

## Private-data exclusions (three migrations)

| Version | Exception |
|---|---|
| `20260916134448` | Original bootstrap inserted an administrator by historical email and inserted a named staff roster. These **data rows** are intentionally omitted. Schema definitions and standard duty-type seed configuration remain. |
| `20260923152254` | Original literal test-account email replaced with `test@example.invalid` in the source copy. |
| `20260923165738` | Original literal test-account email replaced with `test@example.invalid` in the source copy. |

The October 8 privacy migration additionally restricts direct member reads to (id, nickname, color), minimizes access-audit change payloads, and prunes audit rows after 180 days. The current schema catalog and restore companion reflect those grants.

The original SQL SHA-256 hashes remain in the manifest for provenance. These three public files are NOT original verbatim SQL and must never be presented as such. Real administrator provisioning, staff data and environment-specific test-account exclusion must be restored securely from private records or set explicitly on a replacement project. Never commit raw user rows, account emails, refresh tokens, credentials or an unencrypted database dump.

## Recovery of objects never introduced by recorded migrations

Some production schema objects predate recorded migrations or were created manually. Recovered historical SQL alone is not a complete clean-install bootstrap.

- `supabase/schema/application-schema-catalog.json`: current non-data structural inventory of 40 application tables, 85 application functions (signature/privilege/hash metadata), 253 constraints, 122 indexes, 47 table policies, 15 triggers, and 50 table role grants. Source schemas: `public`, `private`. No application rows, passwords or secret-bearing function source are included.
- `supabase/schema/pre-migration-manual-tables.sql`: data-free preliminary definitions for 12 historically unrecorded public tables, plus the preexisting RLS event-trigger helper. The moved `private.admin_users` and `private.app_access` tables are recovered from their historical `public` definitions and migration-time schema moves, so they are not redundantly created here.
- `supabase/schema/post-migration-manual-objects.sql`: restored checks/FKs/unique constraints, indexes, policies, triggers, table grants and two previously unrecorded bead-group permission functions. This companion is deliberately outside `supabase/migrations/` so production version parity remains 43/43.

The names of all 40 current tables and 85 current functions are covered by at least one recorded migration or these schema companions. **Name/source coverage does not prove full schema-equivalent replay**: the scripts have not yet been applied end-to-end to an isolated fresh Supabase instance. The production database was not modified by this reconciliation.

## Safe fresh-environment restore test

1. Provision a completely separate and disposable Supabase project or local Supabase stack with matching PostgreSQL/extension versions. Never test a database reset, historical replay or these recovery companions against the live production project.
2. Make sure Supabase-managed `auth`, `realtime`, and `storage` schemas, extensions and relevant roles are present. Do not commit connection credentials.
3. On that **empty clone only**, load `pre-migration-manual-tables.sql` before the historical migrations; check prerequisites, dependency order, and SQL execution for all 12 tables.
4. Replay the 43 versioned migrations in ascending version order using the supported Supabase migration workflow. Use `supabase --help`, `supabase migration --help` and `supabase migration up --help` for locally installed CLI syntax. Do not mark historical versions as applied without executing/validating their DDL on this new database.
5. On the clone only, apply `post-migration-manual-objects.sql`. Check the catalog of tables, functions, constraints, indexes, triggers, RLS policies and grants against the JSON inventory. Validate that `anon` cannot read/write private business data, and that authenticated users only access authorized rows.
6. Restore private **data backups** through an encrypted off-repository channel. Separately provision administrators and staff, configure the test account exclusion, enable required Auth settings, and validate scheduling, dinner, Pictionary and Blackjack flows.
7. Run `node --test tests/migration-history-parity.test.mjs tests/application-schema-recovery.test.mjs` and `bash scripts/security-check.sh` from the repository. On the clone, additionally check RLS, database functions, Realtime authorization, and cron jobs. A clone passing tests is required before claiming complete disaster-recovery readiness.

These companion scripts are recovery aids based on the current final schema; they have **not** been demonstrated to replay cleanly in a new stack. If a replay reveals ordering conflicts, repair the disposable-clone recovery script with an explicit change, without rewriting the authoritative applied SQL or mutating production.

## Migration version mapping for retired drafts

| Previously versioned file | Applied migration version |
|---|---|
| `20260921090000_pictionary_v1.sql` | `20260921073618_complete_pictionary_v1.sql` |
| `20260921133000_pictionary_security_hardening.sql` | `20260921132428_pictionary_security_hardening.sql` |
| `20260929160000_blackjack_v1.sql` | `20260929081614_blackjack_v1_low_latency.sql` |
| `20260929162500_blackjack_hardening.sql` | `20260929082102_blackjack_v1_hardening.sql` |
| `20261005220000_blackjack_performance_v11.sql` | `20261005141627_blackjack_performance_v11.sql` |
| `20261005221500_blackjack_session_context_hardening.sql` | `20261005141857_blackjack_session_context_hardening.sql` |
| `20261006201500_blackjack_history_cleanup.sql` | `20261006121635_blackjack_history_cleanup.sql` |
| `20261006230000_blackjack_v12.sql` | `20261006151034_blackjack_v12.sql` |
| `20261006233500_blackjack_v13_stats.sql` | `20261006152753_blackjack_v13_stats.sql` |
| `20261007003000_blackjack_v14_casino.sql` | `20261006160940_blackjack_v14_casino.sql` |
| `20261007005500_blackjack_v14_stats_polish.sql` | `20261006161905_blackjack_v14_stats_polish.sql` |
| `20261007214000_pictionary_latency_v2.sql` | `20261007140439_pictionary_latency_v2.sql` |
| `20261007221500_pictionary_latency_v2_hardening.sql` | `20261007140800_pictionary_latency_v2_hardening.sql` |

## Keep the histories aligned

- For every new migration, commit the exact SQL executed, using the actual applied version rather than a guessed timestamp. Update the manifest with the new applied statement SHA-256 and refresh the data-free schema catalog when objects change.
- CI checks that all migration filenames exactly match the manifest and that unredacted files match their production-source hashes. A future migration requires updating this manifest intentionally.
- Use Supabase's migration-list/history-repair features only after confirming a real history discrepancy; **never repair version parity by deleting or inventing applied migration rows**.
- This repository is public: keep real users, Auth configuration secrets, managed schema data, personnel records and database backup payloads private.

References: https://supabase.com/docs/reference/cli/supabase-migration-list and https://supabase.com/docs/guides/local-development/cli-workflows.
