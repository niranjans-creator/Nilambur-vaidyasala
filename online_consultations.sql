-- Online consultations. Run after schema.sql, customer_accounts.sql, and security_hardening.sql.
-- All sensitive writes, payment confirmation, mail queue operations and file access use server-only APIs.

create table if not exists public.doctor_online_slots (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  slot_minutes smallint not null check (slot_minutes in (15,20)),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (end_time > start_time),
  unique (doctor_id, weekday, start_time, end_time)
);
create index if not exists doctor_online_slots_lookup_idx
  on public.doctor_online_slots(doctor_id, weekday) where is_active;

create table if not exists public.online_consultation_settings (
  singleton boolean primary key default true check (singleton),
  fee_paise integer not null default 15000 check (fee_paise between 100 and 10000000),
  updated_at timestamptz not null default now()
);
insert into public.online_consultation_settings(singleton, fee_paise)
values (true, 15000) on conflict (singleton) do nothing;

create table if not exists public.online_consultations (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  user_id uuid references auth.users(id) on delete set null,
  access_token_hash text not null,
  doctor_id uuid not null references public.doctors(id) on delete restrict,
  doctor_name text not null check (char_length(doctor_name) between 2 and 120),
  department text not null check (char_length(department) between 2 and 120),
  qualification text not null default '' check (char_length(qualification) <= 120),
  patient_name text not null check (char_length(patient_name) between 2 and 120),
  age smallint not null check (age between 1 and 120),
  gender text not null check (gender in ('female','male','nonbinary','prefer_not_to_say')),
  phone text not null check (phone ~ '^[+0-9][0-9 -]{7,14}$'),
  patient_email text not null check (patient_email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'),
  questionnaire jsonb not null check (jsonb_typeof(questionnaire) = 'object'),
  uploaded_files jsonb not null default '[]'::jsonb check (jsonb_typeof(uploaded_files) = 'array'),
  appointment_date date,
  appointment_time time,
  timezone text not null default 'Asia/Kolkata' check (timezone = 'Asia/Kolkata'),
  status text not null default 'payment_pending' check (status in ('payment_pending','pending_payment','payment_conflict','confirmed','completed','no_show','cancelled','expired')),
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','failed','refunded')),
  amount_paise integer not null default 15000 check (amount_paise between 100 and 10000000),
  razorpay_order_id text unique,
  razorpay_payment_id text unique,
  paid_at timestamptz,
  hold_expires_at timestamptz,
  meeting_url text not null,
  report_html text,
  report_generated_at timestamptz,
  cancellation_reason text check (char_length(cancellation_reason) <= 500),
  terminal_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((appointment_date is null) = (appointment_time is null))
);
alter table public.online_consultations add column if not exists terminal_at timestamptz;
alter table public.online_consultations add column if not exists report_html text;
alter table public.online_consultations add column if not exists report_generated_at timestamptz;

create index if not exists online_consultations_user_created_idx
  on public.online_consultations(user_id, created_at desc);
create index if not exists online_consultations_date_idx
  on public.online_consultations(appointment_date, appointment_time);
create index if not exists online_consultations_terminal_idx
  on public.online_consultations(terminal_at) where terminal_at is not null;
create unique index if not exists one_active_online_consultation_per_slot
  on public.online_consultations(doctor_id, appointment_date, appointment_time)
  where status in ('pending_payment','confirmed');

create table if not exists public.online_consultation_events (
  id bigint generated always as identity primary key,
  consultation_id uuid not null references public.online_consultations(id) on delete cascade,
  status text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists online_consultation_events_consultation_idx
  on public.online_consultation_events(consultation_id, created_at);

create table if not exists public.online_consultation_payments (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references public.online_consultations(id) on delete cascade,
  razorpay_order_id text not null unique,
  razorpay_payment_id text unique,
  amount_paise integer not null check (amount_paise between 100 and 10000000),
  state text not null default 'created' check (state in ('created','paid','refund_required','refunded','failed')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists online_consultation_payments_consultation_idx
  on public.online_consultation_payments(consultation_id, created_at desc);

create table if not exists public.online_consultation_email_jobs (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references public.online_consultations(id) on delete cascade,
  kind text not null check (kind in ('patient_confirmation','clinic_confirmation','patient_reminder','clinic_reminder','clinic_payment_conflict') or kind like 'resend\_%' or kind like 'patient_report\_%'),
  state text not null default 'pending' check (state in ('pending','sending','sent','failed')),
  attempt_count integer not null default 0,
  last_error text,
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (consultation_id, kind)
);
create index if not exists online_consultation_email_jobs_retry_idx
  on public.online_consultation_email_jobs(state, updated_at);

create table if not exists public.online_consultation_rate_limits (
  key_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0
);

alter table public.doctor_online_slots enable row level security;
alter table public.online_consultation_settings enable row level security;
alter table public.online_consultations enable row level security;
alter table public.online_consultation_events enable row level security;
alter table public.online_consultation_payments enable row level security;
alter table public.online_consultation_email_jobs enable row level security;
alter table public.online_consultation_rate_limits enable row level security;

revoke all on public.doctor_online_slots, public.online_consultation_settings,
  public.online_consultation_events, public.online_consultation_payments, public.online_consultation_email_jobs,
  public.online_consultation_rate_limits from public, anon, authenticated;
revoke all on public.online_consultations from public, anon, authenticated;
grant select on public.online_consultations to authenticated;
drop policy if exists "patients read own online consultations" on public.online_consultations;
create policy "patients read own online consultations" on public.online_consultations
  for select to authenticated using (user_id = auth.uid());

-- Private reports bucket. Patients receive short-lived signed upload tokens from the server;
-- no browser role can list or read objects. Admin file links are also short-lived server signatures.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('consultation-reports','consultation-reports',false,5242880,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public=false, file_size_limit=5242880,
  allowed_mime_types=array['image/jpeg','image/png','image/webp','application/pdf'];
drop policy if exists "online consultation reports server only" on storage.objects;

create or replace function public.reserve_online_consultation(
  p_consultation_id uuid, p_date date, p_time time
) returns boolean language plpgsql security definer set search_path = '' as $$
declare reserved_id uuid; local_now timestamp;
begin
  local_now := now() at time zone 'Asia/Kolkata';
  if p_date < local_now::date or (p_date = local_now::date and p_time <= local_now::time) then return false; end if;
  update public.online_consultations c
  set appointment_date=p_date, appointment_time=p_time, status='pending_payment',
      hold_expires_at=now()+interval '15 minutes', updated_at=now()
  where c.id=p_consultation_id and c.status in ('payment_pending','expired')
    and c.payment_status='pending'
    and exists (
      select 1 from public.doctor_online_slots s
      where s.doctor_id=c.doctor_id and s.weekday=extract(dow from p_date)::smallint and s.is_active
        and p_time >= s.start_time and p_time < s.end_time
        and mod(extract(epoch from (p_time-s.start_time))::integer/60,s.slot_minutes)=0
    )
  returning c.id into reserved_id;
  return reserved_id is not null;
exception when unique_violation then return false;
end;
$$;

create or replace function public.release_online_consultation_hold(p_consultation_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare released_id uuid;
begin
  update public.online_consultations set status='payment_pending', hold_expires_at=null,
    razorpay_order_id=null, updated_at=now()
  where id=p_consultation_id and status='pending_payment' and payment_status='pending'
  returning id into released_id;
  return released_id is not null;
end;
$$;

create or replace function public.reschedule_online_consultation(p_consultation_id uuid,p_date date,p_time time)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed_id uuid; local_now timestamp;
begin
  local_now := now() at time zone 'Asia/Kolkata';
  if p_date < local_now::date or (p_date = local_now::date and p_time <= local_now::time) then return false; end if;
  update public.online_consultations c set appointment_date=p_date,appointment_time=p_time,terminal_at=null,updated_at=now()
  where c.id=p_consultation_id and c.status in ('confirmed','payment_conflict') and exists (
    select 1 from public.doctor_online_slots s
    where s.doctor_id=c.doctor_id and s.weekday=extract(dow from p_date)::smallint and s.is_active
      and p_time >= s.start_time and p_time < s.end_time
      and mod(extract(epoch from (p_time-s.start_time))::integer/60,s.slot_minutes)=0
  ) returning c.id into changed_id;
  if changed_id is not null then
    update public.online_consultations set status='confirmed',cancellation_reason=null,updated_at=now() where id=p_consultation_id;
    insert into public.online_consultation_events(consultation_id,status,note)
    values(p_consultation_id,'confirmed','Rescheduled by clinic');
  end if;
  return changed_id is not null;
exception when unique_violation then return false;
end;
$$;

create or replace function public.confirm_online_consultation_payment(
  p_order_id text, p_payment_id text, p_amount_paise integer, p_currency text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.online_consultations%rowtype; pay public.online_consultation_payments%rowtype;
begin
  select * into pay from public.online_consultation_payments where razorpay_order_id=p_order_id for update;
  if not found then return null; end if;
  select * into c from public.online_consultations where id=pay.consultation_id for update;
  if p_amount_paise <> pay.amount_paise or p_currency <> 'INR' then raise exception 'Payment amount mismatch'; end if;
  if pay.state in ('paid','refunded') then return jsonb_build_object('consultation_id',c.id,'newly_confirmed',false); end if;
  if c.payment_status='paid' then
    update public.online_consultation_payments set state='refund_required',razorpay_payment_id=p_payment_id,paid_at=now() where id=pay.id;
    insert into public.online_consultation_email_jobs(consultation_id,kind) values(c.id,'clinic_payment_conflict') on conflict (consultation_id,kind) do nothing;
    return jsonb_build_object('consultation_id',c.id,'newly_confirmed',false,'payment_conflict',true);
  end if;
  begin
    update public.online_consultations set status='confirmed',payment_status='paid',
      razorpay_payment_id=p_payment_id,paid_at=now(),hold_expires_at=null,updated_at=now()
    where id=c.id and status in ('pending_payment','payment_pending') and appointment_date is not null;
  exception when unique_violation then
    update public.online_consultation_payments set state='refund_required',razorpay_payment_id=p_payment_id,paid_at=now() where id=pay.id;
    update public.online_consultations set status='payment_conflict',payment_status='paid',paid_at=now(),razorpay_payment_id=p_payment_id,terminal_at=coalesce(terminal_at,now()),updated_at=now() where id=c.id;
    insert into public.online_consultation_events(consultation_id,status,note) values(c.id,'payment_conflict','Payment received after the original slot was no longer available');
    insert into public.online_consultation_email_jobs(consultation_id,kind) values(c.id,'clinic_payment_conflict') on conflict (consultation_id,kind) do nothing;
    return jsonb_build_object('consultation_id',c.id,'newly_confirmed',false,'payment_conflict',true);
  end;
  if not found then
    update public.online_consultation_payments set state='refund_required',razorpay_payment_id=p_payment_id,paid_at=now() where id=pay.id;
    update public.online_consultations set status='payment_conflict',payment_status='paid',paid_at=now(),razorpay_payment_id=p_payment_id,terminal_at=coalesce(terminal_at,now()),updated_at=now() where id=c.id;
    insert into public.online_consultation_events(consultation_id,status,note) values(c.id,'payment_conflict','Payment received after consultation state changed');
    insert into public.online_consultation_email_jobs(consultation_id,kind) values(c.id,'clinic_payment_conflict') on conflict (consultation_id,kind) do nothing;
    return jsonb_build_object('consultation_id',c.id,'newly_confirmed',false,'payment_conflict',true);
  end if;
  update public.online_consultation_payments set state='paid',razorpay_payment_id=p_payment_id,paid_at=now() where id=pay.id;
  insert into public.online_consultation_events(consultation_id,status,note)
    values (c.id,'confirmed','Payment verified; consultation confirmed');
  insert into public.online_consultation_email_jobs(consultation_id,kind)
    values (c.id,'patient_confirmation'),(c.id,'clinic_confirmation')
    on conflict (consultation_id,kind) do nothing;
  return jsonb_build_object('consultation_id',c.id,'newly_confirmed',true,'payment_conflict',false);
end;
$$;

create or replace function public.allow_online_consult_request(p_key_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from public.online_consultation_rate_limits where window_started_at < now()-interval '1 day';
  insert into public.online_consultation_rate_limits(key_hash,window_started_at,attempts)
    values(p_key_hash,now(),1)
  on conflict(key_hash) do update set
    window_started_at=case when now()-public.online_consultation_rate_limits.window_started_at >= interval '10 minutes' then now() else public.online_consultation_rate_limits.window_started_at end,
    attempts=case when now()-public.online_consultation_rate_limits.window_started_at >= interval '10 minutes' then 1 else public.online_consultation_rate_limits.attempts+1 end
  returning attempts into n;
  return n <= 5;
end;
$$;

create or replace function public.claim_online_consult_email_job(p_job_id uuid)
returns setof public.online_consultation_email_jobs language plpgsql security definer set search_path = '' as $$
begin
  return query update public.online_consultation_email_jobs j
    set state='sending',attempt_count=j.attempt_count+1,updated_at=now()
    where j.id=p_job_id and (j.state in ('pending','failed') or (j.state='sending' and j.updated_at < now()-interval '15 minutes'))
    returning j.*;
end;
$$;

create or replace function public.finish_online_consult_email_job(p_job_id uuid,p_success boolean,p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update public.online_consultation_email_jobs
  set state=case when p_success then 'sent' else 'failed' end,
      last_error=case when p_success then null else left(coalesce(p_error,'Email send failed'),1000) end,
      sent_at=case when p_success then now() else sent_at end,updated_at=now()
  where id=p_job_id and state='sending'
$$;

revoke all on function public.reserve_online_consultation(uuid,date,time) from public, anon, authenticated;
revoke all on function public.release_online_consultation_hold(uuid) from public, anon, authenticated;
revoke all on function public.reschedule_online_consultation(uuid,date,time) from public, anon, authenticated;
revoke all on function public.confirm_online_consultation_payment(text,text,integer,text) from public, anon, authenticated;
revoke all on function public.allow_online_consult_request(text) from public, anon, authenticated;
revoke all on function public.claim_online_consult_email_job(uuid) from public, anon, authenticated;
revoke all on function public.finish_online_consult_email_job(uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.reserve_online_consultation(uuid,date,time) to service_role;
grant execute on function public.release_online_consultation_hold(uuid) to service_role;
grant execute on function public.reschedule_online_consultation(uuid,date,time) to service_role;
grant execute on function public.confirm_online_consultation_payment(text,text,integer,text) to service_role;
grant execute on function public.allow_online_consult_request(text) to service_role;
grant execute on function public.claim_online_consult_email_job(uuid) to service_role;
grant execute on function public.finish_online_consult_email_job(uuid,boolean,text) to service_role;

