create table if not exists public.threads_coupas_publish_jobs (
  job_id text primary key,
  folder_name text not null unique,
  status text not null check (status in (
    'pending',
    'processing',
    'published',
    'failed',
    'stopped',
    'post_published_link_pending',
    'post_published_reply_failed'
  )),
  started_at timestamptz,
  completed_at timestamptz,
  product_name text,
  original_coupang_url text,
  generated_coupang_url text,
  threads_post_id text,
  threads_post_url text,
  reply_id text,
  error text,
  retry_count integer not null default 0 check (retry_count >= 0),
  match_score numeric(5,4),
  match_candidates jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.threads_coupas_publish_jobs enable row level security;

revoke all on table public.threads_coupas_publish_jobs from anon, authenticated;
grant select, insert, update on table public.threads_coupas_publish_jobs to service_role;
