alter table public.user_access
  add column if not exists budget_default_department text;

update public.user_access
set budget_default_department = budget_department
where budget_default_department is null
  and budget_department is not null
  and btrim(budget_department) <> '';

create table if not exists public.user_access_departments (
  email text not null references public.user_access(email) on delete cascade,
  department text not null,
  created_at timestamptz not null default now(),
  primary key (email, department)
);

insert into public.user_access_departments (email, department)
select email, budget_department
from public.user_access
where budget_department is not null
  and btrim(budget_department) <> ''
on conflict (email, department) do nothing;

create table if not exists public.user_access_aliases (
  alias_email text primary key,
  email text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.budget_access_settings (
  year integer primary key,
  viewer_months smallint[] not null default array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.current_auth_email()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.email_matches_current_user(target_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    lower(target_email) = public.current_auth_email()
    or exists (
      select 1
      from public.user_access_aliases aliases
      where lower(aliases.alias_email) = public.current_auth_email()
        and lower(aliases.email) = lower(target_email)
    );
$$;

drop trigger if exists set_budget_access_settings_updated_at on public.budget_access_settings;
create trigger set_budget_access_settings_updated_at
before update on public.budget_access_settings
for each row
execute function public.set_user_access_updated_at();

insert into public.budget_access_settings (year, viewer_months)
values (2026, array[1,2]::smallint[])
on conflict (year) do update
set viewer_months = excluded.viewer_months,
    updated_at = now();

alter table public.user_access_departments enable row level security;
alter table public.user_access_aliases enable row level security;
alter table public.budget_access_settings enable row level security;

drop policy if exists "users_can_read_own_access" on public.user_access;
create policy "users_can_read_own_access"
on public.user_access
for select
to authenticated
using (public.email_matches_current_user(email));

drop policy if exists "users_can_read_own_access_departments" on public.user_access_departments;
create policy "users_can_read_own_access_departments"
on public.user_access_departments
for select
to authenticated
using (public.email_matches_current_user(email));

drop policy if exists "users_can_read_own_access_aliases" on public.user_access_aliases;
create policy "users_can_read_own_access_aliases"
on public.user_access_aliases
for select
to authenticated
using (
  lower(alias_email) = public.current_auth_email()
  or lower(email) = public.current_auth_email()
);

drop policy if exists "authenticated_can_read_budget_access_settings" on public.budget_access_settings;
create policy "authenticated_can_read_budget_access_settings"
on public.budget_access_settings
for select
to authenticated
using (true);
