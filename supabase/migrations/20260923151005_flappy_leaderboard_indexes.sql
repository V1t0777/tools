create index flappy_runs_member_idx on public.flappy_runs(member_id);
create index flappy_best_run_idx on public.flappy_best_scores(best_run_id);
create index flappy_weekly_user_idx on public.flappy_weekly_bests(user_id);
create index flappy_weekly_member_idx on public.flappy_weekly_bests(member_id);
create index flappy_weekly_run_idx on public.flappy_weekly_bests(best_run_id);

