create extension if not exists pgcrypto;

create table if not exists public.ox_content_library (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('novel', 'longform', 'blog')),
  title text not null,
  status text not null default 'DRAFT' check (status in ('IDEA', 'DRAFT', 'READY', 'USED')),
  topic text not null default '',
  tags text[] not null default '{}',
  content_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ox_content_library_type_status_idx
  on public.ox_content_library (type, status);

create index if not exists ox_content_library_updated_at_idx
  on public.ox_content_library (updated_at desc);

alter table public.ox_content_library enable row level security;
revoke all on table public.ox_content_library from anon, authenticated;
grant select, insert, update on table public.ox_content_library to service_role;

comment on table public.ox_content_library is
  'Structured text-only content generated and managed by the OX Content Studio.';
