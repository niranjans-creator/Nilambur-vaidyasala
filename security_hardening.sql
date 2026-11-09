-- Apply after schema.sql and customer_accounts.sql in Supabase SQL Editor.
-- Restricts writes and makes prices, totals, and appointment schedules authoritative.

create or replace function public.validate_booking_schedule() returns trigger
language plpgsql set search_path = '' as $$
declare dow int; slot_minutes int;
begin
  if new.dept not in ('General Physician','Orthopaedics & Sports Injury','Spine & Back Care','Skin & Beauty Care') then raise exception 'Invalid department'; end if;
  dow := extract(dow from new.appt_date);
  slot_minutes := split_part(new.appt_time, ':', 1)::int * 60 + split_part(new.appt_time, ':', 2)::int;
  if new.appt_time !~ '^(09|10|11|12|13|14|15|16):(00|30)$' then raise exception 'Invalid appointment time'; end if;
  if new.dept = 'Orthopaedics & Sports Injury' and (dow not in (1,4) or slot_minutes < 600 or slot_minutes >= 720) then raise exception 'Outside consultation schedule'; end if;
  if new.dept = 'Spine & Back Care' and (dow <> 0 or slot_minutes < 900 or slot_minutes >= 1020) then raise exception 'Outside consultation schedule'; end if;
  if new.dept in ('General Physician','Skin & Beauty Care') and (dow not in (1,2,3,4,5,6) or slot_minutes < 540 or slot_minutes >= 1020) then raise exception 'Outside consultation schedule'; end if;
  return new;
end $$;
drop trigger if exists bookings_validate_schedule on public.bookings;
create trigger bookings_validate_schedule before insert or update of dept, appt_date, appt_time on public.bookings
for each row execute function public.validate_booking_schedule();

-- Remove broad writes; customers can only submit bookings and call the trusted order RPC.
drop policy if exists "public creates bookings" on public.bookings;
drop policy if exists "customers create bookings" on public.bookings;
create policy "public creates anonymous bookings" on public.bookings for insert to anon
  with check (status = 'new' and user_id is null);
create policy "customers create own bookings" on public.bookings for insert to authenticated
  with check (status = 'new' and user_id = auth.uid());

drop policy if exists "public creates orders" on public.orders;
drop policy if exists "customers create orders" on public.orders;
revoke insert on public.orders from anon, authenticated;

create or replace function public.place_order(p_name text, p_phone text, p_addr text, p_pin text, p_items jsonb)
returns table(order_code text, order_total numeric)
language plpgsql security definer set search_path = '' as $$
declare item jsonb; product_id uuid; qty int; product_row record; order_items jsonb := '[]'::jsonb; subtotal numeric := 0; shipping numeric; code text;
begin
  if char_length(trim(coalesce(p_name,''))) < 2 or char_length(p_name) > 100 then raise exception 'Invalid name'; end if;
  if p_phone !~ '^[+0-9][0-9 -]{7,14}$' then raise exception 'Invalid phone'; end if;
  if char_length(trim(coalesce(p_addr,''))) < 8 or char_length(p_addr) > 1000 then raise exception 'Invalid address'; end if;
  if p_pin !~ '^[0-9]{6}$' then raise exception 'Invalid PIN code'; end if;
  if coalesce(jsonb_typeof(p_items),'') <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then raise exception 'Invalid items'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if item->>'id' is null or coalesce(item->>'q','') !~ '^[1-9][0-9]{0,2}$' then raise exception 'Invalid item quantity'; end if;
    product_id := (item->>'id')::uuid; qty := (item->>'q')::int;
    select id, name, price into product_row from public.products where id = product_id and active;
    if not found then raise exception 'Product unavailable'; end if;
    subtotal := subtotal + product_row.price * qty;
    order_items := order_items || jsonb_build_array(jsonb_build_object('id', product_row.id, 'n', product_row.name, 'q', qty, 'p', product_row.price));
  end loop;
  shipping := case when subtotal = 0 or subtotal >= 999 then 0 else 60 end;
  code := 'NV' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.orders(oid,name,phone,addr,pin,items,total,payment,status,user_id)
  values(code,trim(p_name),trim(p_phone),trim(p_addr),p_pin,order_items,subtotal+shipping,'COD','new',auth.uid());
  return query select code, subtotal + shipping;
end $$;
revoke all on function public.place_order(text,text,text,text,jsonb) from public;
grant execute on function public.place_order(text,text,text,text,jsonb) to anon, authenticated;

-- Admin policies are intentionally limited to authenticated users whose email is in admins.
-- Customers retain their own-row read policies from customer_accounts.sql.
