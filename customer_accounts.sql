-- Run once in Supabase SQL Editor after schema.sql to enable customer accounts.

alter table public.bookings
  add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.orders
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists bookings_user_id_created_at_idx
  on public.bookings(user_id, created_at desc);
create index if not exists orders_user_id_created_at_idx
  on public.orders(user_id, created_at desc);

create table if not exists public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text not null default '',
  created_at timestamptz not null default now());

alter table public.profiles enable row level security;
grant select, insert, update on public.profiles to authenticated;

drop policy if exists "customers read own profile" on public.profiles;
create policy "customers read own profile" on public.profiles
  for select to authenticated using (id = auth.uid());
drop policy if exists "customers create own profile" on public.profiles;
create policy "customers create own profile" on public.profiles
  for insert to authenticated with check (id = auth.uid());
drop policy if exists "customers update own profile" on public.profiles;
create policy "customers update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.create_customer_profile()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles(id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists create_customer_profile on auth.users;
create trigger create_customer_profile
  after insert on auth.users
  for each row execute function public.create_customer_profile();

insert into public.profiles(id, full_name, phone)
select id,
       coalesce(raw_user_meta_data ->> 'full_name', ''),
       coalesce(raw_user_meta_data ->> 'phone', '')
from auth.users
on conflict (id) do nothing;

drop policy if exists "public creates bookings" on public.bookings;
create policy "public creates bookings" on public.bookings
  for insert to anon with check (status = 'new' and user_id is null);
drop policy if exists "customers create bookings" on public.bookings;
create policy "customers create bookings" on public.bookings
  for insert to authenticated with check (status = 'new' and user_id = auth.uid());
drop policy if exists "customers read own bookings" on public.bookings;
create policy "customers read own bookings" on public.bookings
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "public creates orders" on public.orders;
create policy "public creates orders" on public.orders
  for insert to anon with check (status = 'new' and payment = 'COD' and user_id is null);
drop policy if exists "customers create orders" on public.orders;
create policy "customers create orders" on public.orders
  for insert to authenticated with check (
    status = 'new' and payment = 'COD' and user_id = auth.uid()
  );
drop policy if exists "customers read own orders" on public.orders;
create policy "customers read own orders" on public.orders
  for select to authenticated using (user_id = auth.uid());
