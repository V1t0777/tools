
alter table public.pictionary_rounds
  add column if not exists canvas_state jsonb not null default '[]'::jsonb,
  add column if not exists canvas_version bigint not null default 0,
  add column if not exists canvas_updated_at timestamptz;

comment on column public.pictionary_rounds.canvas_state is 'Server-side fallback snapshot for pictionary strokes; writes are restricted to the Edge Function.';
comment on column public.pictionary_rounds.canvas_version is 'Monotonic-ish server timestamp version for canvas fallback synchronization.';

