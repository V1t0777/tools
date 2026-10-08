
grant select on table public.members to service_role;

comment on table public.members is
  'Toolbox member directory. Direct browser access remains constrained by RLS; service_role SELECT is required by trusted Edge Functions for member validation and leaderboard display.';
