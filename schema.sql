-- Run this whole file in Supabase → SQL Editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'student' check (role in ('student','admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.passages (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  topic text,
  level text not null default 'Medium' check (level in ('Easy','Medium','Hard')),
  publish_date date not null default current_date,
  body text,
  html text,
  questions text,
  answers text,
  created_at timestamptz not null default now()
);

-- auto-create a profile whenever a user is created
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name',''),
          coalesce(new.raw_user_meta_data->>'role','student'));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- helper to check admin without RLS recursion
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

alter table public.profiles enable row level security;
alter table public.passages enable row level security;

-- profiles
drop policy if exists "read own profile or admin" on public.profiles;
create policy "read own profile or admin" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- passages: students see only published ones, admins see everything and manage
drop policy if exists "read published passages" on public.passages;
create policy "read published passages" on public.passages for select to authenticated
  using (publish_date <= current_date or public.is_admin());

drop policy if exists "admin insert passages" on public.passages;
create policy "admin insert passages" on public.passages for insert to authenticated with check (public.is_admin());
drop policy if exists "admin update passages" on public.passages;
create policy "admin update passages" on public.passages for update to authenticated using (public.is_admin());
drop policy if exists "admin delete passages" on public.passages;
create policy "admin delete passages" on public.passages for delete to authenticated using (public.is_admin());

-- ONE-TIME: after creating your first user in Dashboard → Authentication → Users,
-- make that user the admin (replace the email):
-- update public.profiles set role = 'admin' where email = 'you@example.com';
