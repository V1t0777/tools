# Historical secret-pattern checks

The security workflow now fetches full history and scans the complete text-file
snapshots of all locally reachable commits, including HEAD and fetched branches
and tags. A secret deleted in a later commit still appears in its older snapshot.
Rules are read from the current security-check.sh; no historical script is executed.

The scanner uses filename-only, NUL-delimited Git output. Reports include commit
IDs and paths, not matched values. Git failures, timeouts, output limits, malformed
patterns and shallow checkouts fail the check rather than silently passing.
Checkout retains read-only permissions and persist-credentials: false.

This remains heuristic detection, not proof that the repository has no secrets.
Binary files, arbitrary passwords, fragmented/encoded values, unreachable/deleted
refs, unfetched refs, forks, release assets, Actions logs/artifacts, comments and
commit-message contents are outside this automated scan. It does not rotate keys
or rewrite history. Confirmed exposed secrets should be revoked first; history
cleanup is a separate explicitly approved operation.

Run locally in a full clone:

    node scripts/secret-history.mjs

Tests create disposable local repositories containing synthetic values; no real
credentials are committed. Coverage includes deleted files, non-current branches,
clean histories, invalid rules and shallow or missing repositories.
