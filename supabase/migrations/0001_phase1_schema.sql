-- ============================================================================
-- Prémios Melhores do Ano Portugal — PHASE 1
-- Migração 0001: esquema base de produção (não-destrutiva, IF NOT EXISTS)
-- Executar no Supabase SQL Editor ou via `supabase db push`.
-- Pré-requisito: extensão pgcrypto para gen_random_uuid().
-- ============================================================================

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- Função utilitária: updated_at automático
-- --------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- --------------------------------------------------------------------------
-- 1. campaigns — edições anuais (2026, 2027, 2028…)
-- --------------------------------------------------------------------------
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  year integer not null unique check (year >= 2020 and year <= 2100),
  start_at timestamptz,
  end_at timestamptz,
  status text not null default 'rascunho'
    check (status in ('rascunho','activa','votacao','encerrada','arquivada')),
  results_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_at is null or end_at is null or start_at < end_at)
);
create index if not exists campaigns_year_idx on public.campaigns (year desc);
create index if not exists campaigns_status_idx on public.campaigns (status);
drop trigger if exists campaigns_touch on public.campaigns;
create trigger campaigns_touch before update on public.campaigns
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------------------
-- 2. cities — centenas de cidades portuguesas
-- --------------------------------------------------------------------------
create table if not exists public.cities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  district text,
  description text,
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cities_active_idx on public.cities (active) where active = true;
create index if not exists cities_district_idx on public.cities (district);
create index if not exists cities_name_trgm_idx on public.cities (name);
drop trigger if exists cities_touch on public.cities;
create trigger cities_touch before update on public.cities
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------------------
-- 3. categories — dezenas de categorias
-- --------------------------------------------------------------------------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  icon text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists categories_active_idx on public.categories (active) where active = true;
drop trigger if exists categories_touch on public.categories;
create trigger categories_touch before update on public.categories
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------------------
-- 4. businesses — milhares de negócios locais
-- --------------------------------------------------------------------------
create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  logo_url text,
  cover_url text,
  website text,
  instagram text,
  facebook text,
  google_maps_url text,
  phone text,
  email text,
  address text,
  city_id uuid references public.cities (id) on delete set null,
  active boolean not null default true,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists businesses_city_idx on public.businesses (city_id);
create index if not exists businesses_active_idx on public.businesses (active) where active = true;
create index if not exists businesses_slug_idx on public.businesses (slug);
drop trigger if exists businesses_touch on public.businesses;
create trigger businesses_touch before update on public.businesses
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------------------
-- 5. business_categories — N:N negócios ↔ categorias
-- --------------------------------------------------------------------------
create table if not exists public.business_categories (
  business_id uuid not null references public.businesses (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (business_id, category_id)
);
create index if not exists business_categories_category_idx
  on public.business_categories (category_id);

-- --------------------------------------------------------------------------
-- 6. campaign_entries — quem participa em que edição/cidade/categoria
-- --------------------------------------------------------------------------
create table if not exists public.campaign_entries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  city_id uuid not null references public.cities (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  active boolean not null default true,
  featured boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, city_id, category_id, business_id)
);
create index if not exists entries_lookup_idx
  on public.campaign_entries (campaign_id, city_id, category_id)
  where active = true;
create index if not exists entries_business_idx on public.campaign_entries (business_id);
create index if not exists entries_featured_idx
  on public.campaign_entries (campaign_id, featured) where featured = true;
drop trigger if exists entries_touch on public.campaign_entries;
create trigger entries_touch before update on public.campaign_entries
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------------------
-- 7. votes — SEM insert público directo (só via Edge Function na Fase 2)
-- --------------------------------------------------------------------------
create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  city_id uuid not null references public.cities (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  campaign_entry_id uuid references public.campaign_entries (id) on delete set null,
  ip_hash text not null,
  device_hash text,
  user_agent_hash text,
  created_at timestamptz not null default now(),
  -- Regra futura: UM voto por IP por categoria/cidade/campanha
  unique (campaign_id, city_id, category_id, ip_hash)
);
create index if not exists votes_tally_idx
  on public.votes (campaign_id, city_id, category_id, business_id);
create index if not exists votes_created_idx on public.votes (created_at desc);

-- --------------------------------------------------------------------------
-- 8. vote_attempts — eventos de segurança / antifraude (sem IP bruto)
-- --------------------------------------------------------------------------
create table if not exists public.vote_attempts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns (id) on delete set null,
  city_id uuid references public.cities (id) on delete set null,
  category_id uuid references public.categories (id) on delete set null,
  business_id uuid references public.businesses (id) on delete set null,
  outcome text not null default 'invalido'
    check (outcome in ('aceite','duplicado','bloqueado','invalido','rate_limit')),
  reason text,
  ip_hash text,
  device_hash text,
  created_at timestamptz not null default now()
);
create index if not exists vote_attempts_created_idx on public.vote_attempts (created_at desc);
create index if not exists vote_attempts_outcome_idx on public.vote_attempts (outcome);

-- --------------------------------------------------------------------------
-- 9. profiles — papéis admin (admin, super_admin). Sem auto-atribuição.
-- --------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'admin'
    check (role in ('admin','super_admin')),
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------------------
-- 10. site_settings — chave/valor flexível
-- --------------------------------------------------------------------------
create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- 11. audit_logs — imutável (sem UPDATE/DELETE para admins)
-- --------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity text,
  entity_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_id);
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);

-- --------------------------------------------------------------------------
-- 12. sponsors — patrocinadores do sítio
-- --------------------------------------------------------------------------
create table if not exists public.sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  website text,
  tier text,
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sponsors_active_idx on public.sponsors (active) where active = true;
drop trigger if exists sponsors_touch on public.sponsors;
create trigger sponsors_touch before update on public.sponsors
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.campaigns enable row level security;
alter table public.cities enable row level security;
alter table public.categories enable row level security;
alter table public.businesses enable row level security;
alter table public.business_categories enable row level security;
alter table public.campaign_entries enable row level security;
alter table public.votes enable row level security;
alter table public.vote_attempts enable row level security;
alter table public.profiles enable row level security;
alter table public.site_settings enable row level security;
alter table public.audit_logs enable row level security;
alter table public.sponsors enable row level security;

-- Função auxiliar: verifica papel admin do utilizador autenticado --------
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'super_admin')
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  );
$$;

-- ---- Leitura pública: apenas registos activos/públicos --------------------
drop policy if exists "public read active cities" on public.cities;
create policy "public read active cities" on public.cities
  for select to anon, authenticated using (active = true);

drop policy if exists "public read active categories" on public.categories;
create policy "public read active categories" on public.categories
  for select to anon, authenticated using (active = true);

drop policy if exists "public read active businesses" on public.businesses;
create policy "public read active businesses" on public.businesses
  for select to anon, authenticated using (active = true);

drop policy if exists "public read active business_categories" on public.business_categories;
create policy "public read active business_categories" on public.business_categories
  for select to anon, authenticated using (true);

drop policy if exists "public read active entries" on public.campaign_entries;
create policy "public read active entries" on public.campaign_entries
  for select to anon, authenticated using (active = true);

drop policy if exists "public read campaigns" on public.campaigns;
create policy "public read campaigns" on public.campaigns
  for select to anon, authenticated using (true);

drop policy if exists "public read settings" on public.site_settings;
create policy "public read settings" on public.site_settings
  for select to anon, authenticated using (true);

drop policy if exists "public read active sponsors" on public.sponsors;
create policy "public read active sponsors" on public.sponsors
  for select to anon, authenticated using (active = true);

-- ---- Votos: NENHUM acesso directo público --------------------------------
-- Sem policy de insert/select público em votes e vote_attempts:
-- a submissão será feita na Fase 2 via Edge Function (service_role).
-- Apenas admins autenticados podem ler agregados.
drop policy if exists "admin read votes" on public.votes;
create policy "admin read votes" on public.votes
  for select to authenticated using (public.is_admin());

drop policy if exists "admin read vote_attempts" on public.vote_attempts;
create policy "admin read vote_attempts" on public.vote_attempts
  for select to authenticated using (public.is_admin());

-- ---- Gestão admin (tudo via is_admin) ------------------------------------
drop policy if exists "admin manage campaigns" on public.campaigns;
create policy "admin manage campaigns" on public.campaigns
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage cities" on public.cities;
create policy "admin manage cities" on public.cities
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage categories" on public.categories;
create policy "admin manage categories" on public.categories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage businesses" on public.businesses;
create policy "admin manage businesses" on public.businesses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage business_categories" on public.business_categories;
create policy "admin manage business_categories" on public.business_categories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage entries" on public.campaign_entries;
create policy "admin manage entries" on public.campaign_entries
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage settings" on public.site_settings;
create policy "admin manage settings" on public.site_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage sponsors" on public.sponsors;
create policy "admin manage sponsors" on public.sponsors
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---- profiles: cada admin lê o próprio; gestão só super_admin ------------
drop policy if exists "users read own profile" on public.profiles;
create policy "users read own profile" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_super_admin());

drop policy if exists "super_admin manage profiles" on public.profiles;
create policy "super_admin manage profiles" on public.profiles
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- ---- audit_logs: só leitura admin; escrita via função/Edge (Fase 2) ------
drop policy if exists "admin read audit" on public.audit_logs;
create policy "admin read audit" on public.audit_logs
  for select to authenticated using (public.is_admin());

-- ============================================================================
-- STORAGE (buckets para imagens) — executar se ainda não existirem
-- ============================================================================
insert into storage.buckets (id, name, public)
values
  ('city-images', 'city-images', true),
  ('business-logos', 'business-logos', true),
  ('business-covers', 'business-covers', true),
  ('sponsor-logos', 'sponsor-logos', true)
on conflict (id) do nothing;

drop policy if exists "public read images" on storage.objects;
create policy "public read images" on storage.objects
  for select to anon, authenticated
  using (bucket_id in ('city-images','business-logos','business-covers','sponsor-logos'));

drop policy if exists "admin upload images" on storage.objects;
create policy "admin upload images" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('city-images','business-logos','business-covers','sponsor-logos')
    and public.is_admin()
  );

drop policy if exists "admin update images" on storage.objects;
create policy "admin update images" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('city-images','business-logos','business-covers','sponsor-logos')
    and public.is_admin()
  );

drop policy if exists "admin delete images" on storage.objects;
create policy "admin delete images" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('city-images','business-logos','business-covers','sponsor-logos')
    and public.is_admin()
  );
