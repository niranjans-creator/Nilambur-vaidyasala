-- Run this whole file once in Supabase > SQL Editor.
-- 1) CHANGE the admin email in the last section before running.

create table products(
  id uuid primary key default gen_random_uuid(),
  name text not null, description text,
  price numeric not null check (price >= 0),
  category text, emoji text, image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now());

create table doctors(
  id uuid primary key default gen_random_uuid(),
  name text not null, dept text, qualification text, experience text, photo_url text,
  created_at timestamptz not null default now());

create table bookings(
  id uuid primary key default gen_random_uuid(),
  ref text, dept text not null,
  appt_date date not null, appt_time text not null,
  name text not null check (char_length(name) <= 100),
  age int check (age between 0 and 120),
  phone text not null check (char_length(phone) <= 20),
  note text check (char_length(note) <= 500),
  status text not null default 'new' check (status in ('new','confirmed','completed','cancelled')),
  created_at timestamptz not null default now());
-- One active booking per department/date/time: blocks double booking.
create unique index one_booking_per_slot on bookings(dept, appt_date, appt_time) where status <> 'cancelled';

create table orders(
  id uuid primary key default gen_random_uuid(),
  oid text, name text not null check (char_length(name) <= 100),
  phone text not null check (char_length(phone) <= 20),
  addr text, pin text,
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  total numeric not null check (total >= 0),
  payment text not null default 'COD',
  status text not null default 'new' check (status in ('new','confirmed','shipped','delivered','cancelled')),
  created_at timestamptz not null default now());

-- Keep appointment validity on the database side too; browser checks can be bypassed.
create function validate_booking_schedule() returns trigger language plpgsql
set search_path = '' as $$
declare dow int; slot_minutes int;
begin
  if new.dept not in ('General Physician','Orthopaedics & Sports Injury','Spine & Back Care','Skin & Beauty Care') then
    raise exception 'Invalid department';
  end if;
  dow := extract(dow from new.appt_date);
  slot_minutes := split_part(new.appt_time, ':', 1)::int * 60 + split_part(new.appt_time, ':', 2)::int;
  if new.appt_time !~ '^(09|10|11|12|14|15|16):(00|30)$' then raise exception 'Invalid appointment time'; end if;
  if new.dept = 'Orthopaedics & Sports Injury' and (dow not in (1,4) or slot_minutes < 600 or slot_minutes >= 720) then raise exception 'Outside consultation schedule'; end if;
  if new.dept = 'Spine & Back Care' and (dow <> 0 or slot_minutes < 900 or slot_minutes >= 1020) then raise exception 'Outside consultation schedule'; end if;
  if new.dept in ('General Physician','Skin & Beauty Care') and (dow not in (1,2,3,4,5,6) or slot_minutes not in (540,570,600,630,660,690,720,750,840,870,900,930,960,990)) then raise exception 'Outside consultation schedule'; end if;
  return new;
end $$;
create trigger bookings_validate_schedule before insert or update of dept, appt_date, appt_time on bookings
for each row execute function validate_booking_schedule();

create table admins(email text primary key);
create function is_admin() returns boolean language sql security definer stable set search_path = public as
$$ select exists(select 1 from admins where email = (auth.jwt() ->> 'email')) $$;
grant execute on function is_admin() to anon, authenticated;

-- Public can see booked TIMES only (no patient data).
create function taken_slots(d date, dp text) returns table(appt_time text) language sql security definer set search_path = public as
$$ select b.appt_time from bookings b where b.appt_date = d and b.dept = dp and b.status <> 'cancelled' $$;
grant execute on function taken_slots(date, text) to anon, authenticated;

alter table products enable row level security;
alter table doctors  enable row level security;
alter table bookings enable row level security;
alter table orders   enable row level security;
alter table admins   enable row level security;

create policy "public reads live products" on products for select using (active or is_admin());
create policy "admin writes products" on products for all to authenticated using (is_admin()) with check (is_admin());
create policy "public reads doctors" on doctors for select using (true);
create policy "admin writes doctors" on doctors for all to authenticated using (is_admin()) with check (is_admin());
create policy "public creates bookings" on bookings for insert to anon, authenticated with check (status = 'new');
create policy "admin manages bookings" on bookings for all to authenticated using (is_admin()) with check (is_admin());
create policy "public creates orders" on orders for insert to anon, authenticated with check (status = 'new' and payment = 'COD');
create policy "admin manages orders" on orders for all to authenticated using (is_admin()) with check (is_admin());

-- Image storage (product + doctor photos)
insert into storage.buckets(id, name, public) values ('images','images', true) on conflict do nothing;
create policy "public reads images" on storage.objects for select using (bucket_id = 'images');
create policy "admin writes images" on storage.objects for all to authenticated
  using (bucket_id = 'images' and is_admin()) with check (bucket_id = 'images' and is_admin());

-- 2) YOUR admin login email (create the same user in Authentication > Users):
insert into admins(email) values ('mditniranjan@gmail.com');
