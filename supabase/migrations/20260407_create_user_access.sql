create table if not exists public.user_access (
  email text primary key,
  role text not null default 'restricted' check (role in ('admin', 'budget_admin', 'restricted')),
  budget_department text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_user_access_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_access_updated_at on public.user_access;
create trigger set_user_access_updated_at
before update on public.user_access
for each row
execute function public.set_user_access_updated_at();

alter table public.user_access enable row level security;

drop policy if exists "users_can_read_own_access" on public.user_access;
create policy "users_can_read_own_access"
on public.user_access
for select
to authenticated
using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
