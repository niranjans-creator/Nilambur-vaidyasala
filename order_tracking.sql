-- Order tracking and customer cancellation. Run after security_hardening.sql.
-- All customer-facing order lookup/change operations go through narrow RPCs.

alter table public.orders add column if not exists cancelled_at timestamptz;
alter table public.orders add column if not exists cancel_reason text;
update public.orders
set cancelled_at = coalesce(cancelled_at, created_at),
    cancel_reason = coalesce(nullif(cancel_reason, ''), 'Previously cancelled')
where status = 'cancelled';

create table if not exists public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  status text not null check (status in ('new','confirmed','shipped','delivered','cancelled')),
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists order_events_order_created_idx on public.order_events(order_id, created_at);
alter table public.order_events enable row level security;
revoke all on public.order_events from public, anon, authenticated;

-- Backfill one placed event per existing order; safe to repeat.
insert into public.order_events(order_id, status, note, created_at)
select o.id, 'new', 'Order placed', o.created_at
from public.orders o
where not exists (
  select 1 from public.order_events e where e.order_id = o.id and e.status = 'new'
);
insert into public.order_events(order_id, status, note, created_at)
select o.id, 'cancelled', coalesce(nullif(o.cancel_reason, ''), 'Previously cancelled'), coalesce(o.cancelled_at, o.created_at)
from public.orders o
where o.status = 'cancelled'
  and not exists (select 1 from public.order_events e where e.order_id = o.id and e.status = 'cancelled');
-- Existing orders do not have a prior status audit trail. Record the current
-- non-new state at migration time, clearly marked as a baseline in its note.
insert into public.order_events(order_id, status, note, created_at)
select o.id, o.status, 'Status baseline at tracking setup; earlier history unavailable', clock_timestamp()
from public.orders o
where o.status not in ('new','cancelled')
  and not exists (select 1 from public.order_events e where e.order_id = o.id and e.status = o.status);

create or replace function public.record_order_status_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare event_note text;
begin
  if tg_op = 'INSERT' then
    insert into public.order_events(order_id, status, note, created_at)
    values (new.id, new.status, 'Order placed', new.created_at);
    return new;
  end if;
  if new.status is distinct from old.status then
    event_note := case
      when new.status = 'cancelled' then coalesce(nullif(new.cancel_reason, ''), 'Cancelled by staff')
      when new.status = 'confirmed' then 'Order confirmed'
      when new.status = 'shipped' then 'Order shipped'
      when new.status = 'delivered' then 'Order delivered'
      else 'Order status updated'
    end;
    insert into public.order_events(order_id, status, note)
    values (new.id, new.status, event_note);
  end if;
  return new;
end;
$$;
drop trigger if exists orders_record_status_event on public.orders;
create trigger orders_record_status_event
after insert or update of status on public.orders
for each row execute function public.record_order_status_event();

-- Store only a keyed hash of the phone number for the anonymous 10-attempt /
-- 15-minute lookup and cancellation limit. No client role can inspect either table.
create table if not exists public.order_lookup_secret (
  singleton boolean primary key default true check (singleton),
  secret text not null
);
alter table public.order_lookup_secret enable row level security;
revoke all on public.order_lookup_secret from public, anon, authenticated;
insert into public.order_lookup_secret(singleton, secret)
values (true, gen_random_uuid()::text)
on conflict (singleton) do nothing;

create table if not exists public.order_lookup_attempts (
  phone_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0
);
create index if not exists order_lookup_attempts_window_started_idx on public.order_lookup_attempts(window_started_at);
alter table public.order_lookup_attempts enable row level security;
revoke all on public.order_lookup_attempts from public, anon, authenticated;

create or replace function public.order_lookup_allowed(p_phone_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare current_attempts integer;
begin
  delete from public.order_lookup_attempts
  where window_started_at < clock_timestamp() - interval '1 day';
  insert into public.order_lookup_attempts(phone_hash, window_started_at, attempts)
  values (p_phone_hash, clock_timestamp(), 1)
  on conflict (phone_hash) do update set
    window_started_at = case
      when clock_timestamp() - public.order_lookup_attempts.window_started_at >= interval '15 minutes'
        then clock_timestamp()
      else public.order_lookup_attempts.window_started_at
    end,
    attempts = case
      when clock_timestamp() - public.order_lookup_attempts.window_started_at >= interval '15 minutes'
        then 1
      else public.order_lookup_attempts.attempts + 1
    end
  returning attempts into current_attempts;
  return current_attempts <= 10;
end;
$$;
revoke all on function public.order_lookup_allowed(text) from public, anon, authenticated;

create or replace function public.track_order(p_code text, p_phone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; normalized_phone text; phone_digest text; allowed boolean;
begin
  if coalesce(p_code, '') !~ '^NV[A-F0-9]{10}$'
     or coalesce(p_phone, '') !~ '^[+0-9][0-9 -]{7,14}$' then
    return null;
  end if;
  normalized_phone := regexp_replace(p_phone, '[^0-9]', '', 'g');
  if char_length(normalized_phone) not between 8 and 15 then return null; end if;
  select encode(sha256(convert_to(s.secret || ':' || normalized_phone, 'UTF8')), 'hex')
    into phone_digest from public.order_lookup_secret s where s.singleton;
  allowed := public.order_lookup_allowed(phone_digest);
  if not allowed then return null; end if;

  select jsonb_build_object(
    'code', o.oid,
    'placed_at', o.created_at,
    'items', o.items,
    'total', o.total,
    'pin', o.pin,
    'status', o.status,
    'cancelled_at', o.cancelled_at,
    'cancel_reason', o.cancel_reason,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('status', e.status, 'note', e.note, 'created_at', e.created_at) order by e.created_at)
      from public.order_events e where e.order_id = o.id
    ), '[]'::jsonb)
  ) into result
  from public.orders o
  where upper(o.oid) = upper(p_code)
    and (
      (auth.uid() is not null and o.user_id = auth.uid())
      or (o.user_id is null and regexp_replace(o.phone, '[^0-9]', '', 'g') = normalized_phone)
    );
  return result;
end;
$$;
revoke all on function public.track_order(text, text) from public;
grant execute on function public.track_order(text, text) to anon, authenticated;

create or replace function public.cancel_order(p_code text, p_phone text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target public.orders%rowtype; normalized_phone text; phone_digest text; allowed boolean;
begin
  if coalesce(p_code, '') !~ '^NV[A-F0-9]{10}$'
     or coalesce(p_phone, '') !~ '^[+0-9][0-9 -]{7,14}$'
     or (p_reason is not null and (char_length(p_reason) > 200 or p_reason not in ('ordered by mistake','found a better price','delivery too slow','other'))) then
    return null;
  end if;
  normalized_phone := regexp_replace(p_phone, '[^0-9]', '', 'g');
  if char_length(normalized_phone) not between 8 and 15 then return null; end if;
  select encode(sha256(convert_to(s.secret || ':' || normalized_phone, 'UTF8')), 'hex')
    into phone_digest from public.order_lookup_secret s where s.singleton;
  allowed := public.order_lookup_allowed(phone_digest);
  if not allowed then return null; end if;

  select * into target from public.orders o
  where upper(o.oid) = upper(p_code)
    and (
      (auth.uid() is not null and o.user_id = auth.uid())
      or (o.user_id is null and regexp_replace(o.phone, '[^0-9]', '', 'g') = normalized_phone)
    )
  for update;
  if not found then return null; end if;
  if target.status = 'cancelled' then
    return jsonb_build_object('status', target.status, 'cancelled_at', target.cancelled_at, 'cancel_reason', target.cancel_reason);
  end if;
  if target.status not in ('new','confirmed') then
    return jsonb_build_object('status', target.status, 'not_cancellable', true);
  end if;
  update public.orders
  set status = 'cancelled', cancelled_at = clock_timestamp(),
      cancel_reason = coalesce(nullif(trim(p_reason), ''), 'Not provided')
  where id = target.id
  returning * into target;
  return jsonb_build_object('status', target.status, 'cancelled_at', target.cancelled_at, 'cancel_reason', target.cancel_reason);
end;
$$;
revoke all on function public.cancel_order(text, text, text) from public;
grant execute on function public.cancel_order(text, text, text) to anon, authenticated;

-- Admin writes now use this RPC; customer/guest table UPDATE remains revoked.
create or replace function public.admin_update_order_status(p_order_id uuid, p_status text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  if p_status not in ('new','confirmed','shipped','delivered','cancelled') then raise exception 'Invalid order status'; end if;
  update public.orders
  set status = p_status,
      cancelled_at = case when p_status = 'cancelled' then coalesce(cancelled_at, clock_timestamp()) else cancelled_at end,
      cancel_reason = case when p_status = 'cancelled' then coalesce(nullif(cancel_reason, ''), 'Cancelled by staff') else cancel_reason end
  where id = p_order_id and status <> 'cancelled';
  return found;
end;
$$;
revoke all on function public.admin_update_order_status(uuid, text) from public;
grant execute on function public.admin_update_order_status(uuid, text) to authenticated;

revoke insert, update, delete on public.orders from public, anon, authenticated;

