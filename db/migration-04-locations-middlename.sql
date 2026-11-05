-- MerchSys migration 04: real BU colleges/campuses as pickup locations + middle name
-- Run AFTER migration-02 and 03. Safe to run more than once.

-- 1. Names split into parts (full_name is still kept for display)
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists middle_name text;
alter table public.profiles add column if not exists last_name text;

-- best-effort fill for accounts created before this migration
update public.profiles set
  last_name  = case when full_name ~ '\s' then regexp_replace(full_name, '^.*\s', '') end,
  first_name = case when full_name ~ '\s' then regexp_replace(full_name, '\s+\S+$', '') else full_name end
where first_name is null and last_name is null;

-- 2. Pickup locations: the placeholder Daraga campus is not in the real list, so hide it
update public.campuses set is_active = false where name = 'BU Daraga Campus';
update public.campuses set sort_order = 1  where name = 'BU Main Campus';
update public.campuses set sort_order = 30 where name = 'BU Gubat Campus';
update public.campuses set sort_order = 31 where name = 'BU Guinobatan Campus';
update public.campuses set sort_order = 32 where name = 'BU Polangui Campus';
update public.campuses set sort_order = 33 where name = 'BU Tabaco Campus';

with v(name, is_main, sort_order) as (values
  ('College of Arts and Letters', false, 10),
  ('College of Education', false, 11),
  ('College of Law', false, 12),
  ('College of Medicine', false, 13),
  ('College of Nursing', false, 14),
  ('College of Science', false, 15),
  ('Jesse M. Robredo Institute of Governance and Development', false, 16),
  ('Institute of Physical Education Sports and Recreation', false, 17),
  ('College of Dental Medicine', false, 18),
  ('Graduate School', false, 19),
  ('Open University', false, 20),
  ('College of Engineering', false, 21),
  ('College of Industrial Technology', false, 22),
  ('Institute of Design and Architecture', false, 23),
  ('College of Business Economics and Management', false, 24),
  ('College of Social Sciences and Philosophy', false, 25)
)
insert into public.campuses (name, is_main, pickup_note, sort_order)
select v.name, v.is_main,
  'Your order will be delivered to your college. Bring your school ID and your order number. If delivery is delayed, you may be asked to pick up at the Main Campus.',
  v.sort_order
from v
where not exists (select 1 from public.campuses c where c.name = v.name);
