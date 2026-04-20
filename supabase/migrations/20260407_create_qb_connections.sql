create table if not exists public.qb_connections (
  entity text primary key check (entity in ('Opco', 'Foundation', 'Juku', 'Zagreus')),
  realm_id text not null unique,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  connected_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_qb_connections_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_qb_connections_updated_at on public.qb_connections;
create trigger set_qb_connections_updated_at
before update on public.qb_connections
for each row
execute function public.set_qb_connections_updated_at();

alter table public.qb_connections enable row level security;
