-- BU Merch migration 03: student info collected at sign up
-- Run in Supabase SQL Editor AFTER migration-02. Safe to run more than once.

alter table public.profiles add column if not exists student_id text;
alter table public.profiles add column if not exists year_level text;
alter table public.profiles add column if not exists block text;
alter table public.profiles add column if not exists address text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists campus_id uuid references public.campuses(id);

alter table public.profiles drop constraint if exists profiles_year_level_check;
alter table public.profiles add constraint profiles_year_level_check
  check (year_level is null or year_level in ('1st Year','2nd Year','3rd Year','4th Year','5th Year'));

-- one account per student ID (accounts created before this migration have none)
create unique index if not exists uq_profiles_student_id on public.profiles (student_id) where student_id is not null;
create index if not exists idx_profiles_campus on public.profiles (campus_id);
