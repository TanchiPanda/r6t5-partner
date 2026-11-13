-- 在 R6T5 Hub 的 Supabase（国际节点）SQL Editor 执行一次
create table if not exists public.partner_profile (
  id uuid primary key default gen_random_uuid(),
  hub_sub text unique not null,
  email text,
  plan text default 'free',
  created_at timestamptz default now()
);

create table if not exists public.partner_supabase (
  partner_id uuid primary key references public.partner_profile(id) on delete cascade,
  url text not null,
  anon_key text not null,
  verify_token text,
  status text default 'pending',
  embed_enabled boolean default false,
  verified_at timestamptz,
  updated_at timestamptz default now()
);

create table if not exists public.partner_app (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references public.partner_profile(id) on delete cascade,
  emoji text default '📄',
  name text not null,
  site_url text,
  created_at timestamptz default now()
);

alter table public.partner_profile enable row level security;
alter table public.partner_supabase enable row level security;
alter table public.partner_app enable row level security;

drop policy if exists p_self on public.partner_profile;
create policy p_self on public.partner_profile for all
  using (hub_sub = coalesce(auth.jwt()->>'sub','')) with check (hub_sub = coalesce(auth.jwt()->>'sub',''));

drop policy if exists s_self on public.partner_supabase;
create policy s_self on public.partner_supabase for all
  using (partner_id in (select id from public.partner_profile where hub_sub = coalesce(auth.jwt()->>'sub','')))
  with check (partner_id in (select id from public.partner_profile where hub_sub = coalesce(auth.jwt()->>'sub','')));

drop policy if exists a_self on public.partner_app;
create policy a_self on public.partner_app for all
  using (partner_id in (select id from public.partner_profile where hub_sub = coalesce(auth.jwt()->>'sub','')))
  with check (partner_id in (select id from public.partner_profile where hub_sub = coalesce(auth.jwt()->>'sub','')));

-- 给嵌入组件公开读取（只读，且仅已开通嵌入的站点）
drop policy if exists s_public on public.partner_supabase;
create policy s_public on public.partner_supabase for select
  using (embed_enabled = true);

drop policy if exists a_public on public.partner_app;
create policy a_public on public.partner_app for select
  using (partner_id in (select partner_id from public.partner_supabase where embed_enabled = true));
