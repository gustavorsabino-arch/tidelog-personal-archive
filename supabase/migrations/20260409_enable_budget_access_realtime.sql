do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'user_access'
    ) then
      execute 'alter publication supabase_realtime add table public.user_access';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'user_access_departments'
    ) then
      execute 'alter publication supabase_realtime add table public.user_access_departments';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'user_access_aliases'
    ) then
      execute 'alter publication supabase_realtime add table public.user_access_aliases';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'budget_access_settings'
    ) then
      execute 'alter publication supabase_realtime add table public.budget_access_settings';
    end if;
  end if;
end;
$$;
