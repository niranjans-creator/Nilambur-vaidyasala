-- Seed the doctors and departments shown on the clinic poster.
-- Safe to run again; also corrects the former spelling of Dr. Salim's name.
update public.doctors
set name = 'Dr. Salim M. Thamban'
where lower(name) = lower('Dr. Salim M. Thonnur')
  and not exists (
    select 1 from public.doctors existing
    where lower(existing.name) = lower('Dr. Salim M. Thamban')
  );

update public.doctors
set name = 'Dr. Mohammed Ameen'
where lower(name) = lower('Dr. Muhammad Ameen')
  and not exists (
    select 1 from public.doctors existing
    where lower(existing.name) = lower('Dr. Mohammed Ameen')
  );

insert into public.doctors(name, dept, qualification)
select d.name, d.dept, d.qualification
from (values
  ('Dr. Sheji U.K.', 'General Physician', 'B.A.M.S.'),
  ('Dr. Mohammed Ameen', 'Orthopaedics & Sports Injury', 'B.U.M.S.'),
  ('Dr. Salim M. Thamban', 'Spine & Back Care', 'B.A.M.S.'),
  ('Dr. Sripriya R.U.', 'Skin & Beauty Care', 'B.A.M.S.')
) as d(name, dept, qualification)
where not exists (
  select 1 from public.doctors existing
  where lower(existing.name) = lower(d.name)
);
