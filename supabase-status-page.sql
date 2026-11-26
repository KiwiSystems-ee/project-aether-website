-- Project Aether public status page with Owner/Co-owner editing.
-- Apply the existing supabase-aether-roles.sql migration first.
-- Run this file in Supabase Dashboard > SQL Editor.

create table if not exists public.aether_status_services (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) between 1 and 60),
  description text not null default '' check (char_length(description) <= 160),
  status text not null default 'operational'
    check (status in ('operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.aether_status_incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 120),
  status text not null default 'investigating'
    check (status in ('investigating', 'identified', 'monitoring', 'resolved')),
  impact text not null default 'minor' check (impact in ('minor', 'major', 'critical')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.aether_status_updates (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.aether_status_incidents(id) on delete cascade,
  status text not null check (status in ('investigating', 'identified', 'monitoring', 'resolved')),
  message text not null check (char_length(trim(message)) between 1 and 2000),
  created_at timestamptz not null default now(),
  author_id uuid references auth.users(id) on delete set null
);

create index if not exists aether_status_incidents_created_idx on public.aether_status_incidents(created_at desc);
create index if not exists aether_status_updates_incident_idx on public.aether_status_updates(incident_id, created_at desc);

alter table public.aether_status_services enable row level security;
alter table public.aether_status_incidents enable row level security;
alter table public.aether_status_updates enable row level security;

drop policy if exists "Public can read status services" on public.aether_status_services;
create policy "Public can read status services" on public.aether_status_services for select to anon, authenticated using (true);
drop policy if exists "Owners can add status services" on public.aether_status_services;
create policy "Owners can add status services" on public.aether_status_services for insert to authenticated
  with check ((public.aether_has_role('Owner') or public.aether_has_role('Co-owner')) and created_by = auth.uid() and updated_by = auth.uid());
drop policy if exists "Owners can edit status services" on public.aether_status_services;
create policy "Owners can edit status services" on public.aether_status_services for update to authenticated
  using (public.aether_has_role('Owner') or public.aether_has_role('Co-owner'))
  with check ((public.aether_has_role('Owner') or public.aether_has_role('Co-owner')) and updated_by = auth.uid());
drop policy if exists "Owners can remove status services" on public.aether_status_services;
create policy "Owners can remove status services" on public.aether_status_services for delete to authenticated
  using (public.aether_has_role('Owner') or public.aether_has_role('Co-owner'));

drop policy if exists "Public can read status incidents" on public.aether_status_incidents;
create policy "Public can read status incidents" on public.aether_status_incidents for select to anon, authenticated using (true);
drop policy if exists "Owners can post status incidents" on public.aether_status_incidents;
create policy "Owners can post status incidents" on public.aether_status_incidents for insert to authenticated
  with check ((public.aether_has_role('Owner') or public.aether_has_role('Co-owner')) and created_by = auth.uid() and updated_by = auth.uid());
drop policy if exists "Owners can edit status incidents" on public.aether_status_incidents;
create policy "Owners can edit status incidents" on public.aether_status_incidents for update to authenticated
  using (public.aether_has_role('Owner') or public.aether_has_role('Co-owner'))
  with check ((public.aether_has_role('Owner') or public.aether_has_role('Co-owner')) and updated_by = auth.uid());

drop policy if exists "Public can read status updates" on public.aether_status_updates;
create policy "Public can read status updates" on public.aether_status_updates for select to anon, authenticated using (true);
drop policy if exists "Owners can add status updates" on public.aether_status_updates;
create policy "Owners can add status updates" on public.aether_status_updates for insert to authenticated
  with check ((public.aether_has_role('Owner') or public.aether_has_role('Co-owner')) and author_id = auth.uid());

grant select on public.aether_status_services, public.aether_status_incidents, public.aether_status_updates to anon, authenticated;
grant insert, update, delete on public.aether_status_services to authenticated;
grant insert, update on public.aether_status_incidents to authenticated;
grant insert on public.aether_status_updates to authenticated;

insert into public.aether_status_services (name, description, status, sort_order)
values
  ('Website', 'Project Aether pages and downloads.', 'operational', 10),
  ('Aether accounts', 'Sign-in and account security.', 'operational', 20),
  ('Launcher downloads', 'Access to the current launcher installer.', 'operational', 30),
  ('Community', 'Community posts and player profiles.', 'operational', 40),
  ('Mod hubs', 'Java and Bedrock add-on discovery.', 'operational', 50)
on conflict (name) do nothing;
