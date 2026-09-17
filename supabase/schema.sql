-- ============================================================
--  김종현 주간 레포트 — Supabase 스키마 (전체)
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query
--    이 파일 전체를 붙여넣고 Run.  이 파일 하나면 끝난다.
--
--  여러 번 실행해도 안전하다 (있으면 건너뛰고, 정책은 새로 만든다).
--
--  중요
--    브라우저에는 publishable key 만 넣는다. 그 키는 공개돼도 되지만,
--    그것은 아래 RLS 가 모든 표에 켜져 있을 때만 성립한다.
--    RLS 를 끄면 키를 아는 누구나 전체 자료를 읽는다.
--    secret key · service_role key 는 절대 브라우저·저장소에 넣지 않는다.
--
--  표 아홉 개
--    students  field_defs  week_common  entries  published
--    sent  snippets  app_settings  class_info
-- ============================================================


-- ------------------------------------------------------------
--  0. 공통 — updated_at 자동 갱신
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ------------------------------------------------------------
--  1. students — 학생 명단
--     extra 는 '학생 칸'(내가 이름 짓는 칸)의 값이 들어가는 자리다.
--     칸을 추가해도 표 구조를 바꿀 필요가 없다.
-- ------------------------------------------------------------
create table if not exists public.students (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  slug           text not null,                    -- 파일명에 쓰는 로마자
  school         text not null default '',
  grade          text not null default '',
  class_name     text not null default '',
  parent_title   text not null default '',         -- 어머님 / 아버님 …
  parent_phone   text not null default '',
  parent_phone2  text not null default '',
  extra          jsonb not null default '{}'::jsonb,
  archived       boolean not null default false,   -- 퇴원 학생은 지우지 않고 내린다
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint students_name_not_blank check (length(btrim(name)) > 0),
  constraint students_slug_format    check (slug ~ '^[a-z0-9]+$')
);

-- 로마자가 겹치면 다른 학생의 링크와 헷갈린다
create unique index if not exists students_slug_key     on public.students (slug);
create index        if not exists students_class_idx    on public.students (class_name);
create index        if not exists students_archived_idx on public.students (archived);

drop trigger if exists students_touch on public.students;
create trigger students_touch before update on public.students
  for each row execute function public.touch_updated_at();


-- ------------------------------------------------------------
--  2. field_defs — 내가 이름 짓는 칸의 '정의'
--
--     scope         이 칸이 학생에 붙는지(student) 반에 붙는지(class)
--                     student → 값은 students.extra
--                     class   → 값은 class_info.extra
--     show_in_table 명단 표에 열로 보일지. 여러 줄 글처럼 긴 칸은 꺼 둔다.
--                   (반 칸에는 쓰이지 않는다. 표는 학생 것이므로)
--     key           extra 안에서 칸을 찾는 이름. 한 번 정하면 바꾸지 않는다.
--                   그래서 화면에 보이는 label 을 바꿔도 값이 그대로 따라온다.
-- ------------------------------------------------------------
create table if not exists public.field_defs (
  id            uuid primary key default gen_random_uuid(),
  key           text not null,
  label         text not null,                       -- 화면에 보이는 이름
  type          text not null default 'text',
  options       jsonb not null default '[]'::jsonb,  -- select 일 때 선택지
  scope         text not null default 'student',
  show_in_table boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),

  constraint field_defs_key_format check (key ~ '^[a-z][a-z0-9_]*$'),
  constraint field_defs_type_check
    check (type in ('text','textarea','number','select','date','checkbox')),
  constraint field_defs_scope_check check (scope in ('student','class'))
);

create unique index if not exists field_defs_key_key on public.field_defs (key);


-- ------------------------------------------------------------
--  3. week_common — 반 공통 (그 주, 그 반의 수업 내용·테스트 이름)
--     한 반에 한 번만 입력하면 그 반 학생 전원에게 들어간다.
-- ------------------------------------------------------------
create table if not exists public.week_common (
  id          uuid primary key default gen_random_uuid(),
  week_start  date not null,
  week_end    date not null,
  class_name  text not null,
  lessons     jsonb not null default '[]'::jsonb,  -- ["1차시 내용", …]
  tests       jsonb not null default '[]'::jsonb,  -- ["문법 리뷰테스트", …]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists week_common_key on public.week_common (week_start, class_name);

drop trigger if exists week_common_touch on public.week_common;
create trigger week_common_touch before update on public.week_common
  for each row execute function public.touch_updated_at();


-- ------------------------------------------------------------
--  4. entries — 학생별 주간 입력
--     제출률은 homework 에서 계산하므로 따로 저장하지 않는다.
-- ------------------------------------------------------------
create table if not exists public.entries (
  id             uuid primary key default gen_random_uuid(),
  week_start     date not null,
  student_id     uuid not null references public.students(id) on delete cascade,
  attend_status  text not null default '',           -- attend|late|absent|makeup
  attend_note    text not null default '',
  focus_score    smallint not null default 0,
  scores         jsonb not null default '{}'::jsonb, -- {"0":95,"1":88}
  homework       jsonb not null default '{}'::jsonb, -- {"월":true,…}
  on_time_rate   smallint not null default 100,
  comment        text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint entries_status_check check (attend_status in ('','attend','late','absent','makeup')),
  constraint entries_focus_check  check (focus_score between 0 and 5),
  constraint entries_ontime_check check (on_time_rate between 0 and 100)
);

create unique index if not exists entries_week_student_key on public.entries (week_start, student_id);
create index        if not exists entries_week_idx         on public.entries (week_start);

drop trigger if exists entries_touch on public.entries;
create trigger entries_touch before update on public.entries
  for each row execute function public.touch_updated_at();


-- ------------------------------------------------------------
--  5. published — 발행 이력
--     path 를 여기 남겨 두면, 같은 주차를 다시 발행해도
--     학부모에게 보낸 링크가 바뀌지 않는다.
-- ------------------------------------------------------------
create table if not exists public.published (
  id            uuid primary key default gen_random_uuid(),
  week_start    date not null,
  student_id    uuid not null references public.students(id) on delete cascade,
  path          text not null,                     -- /r/2026/0601-haneul-a7f3.html
  url           text not null,
  commit_sha    text not null default '',
  published_at  timestamptz not null default now()
);

create unique index if not exists published_week_student_key on public.published (week_start, student_id);


-- ------------------------------------------------------------
--  6. sent — 보냄 표시 (주차별로 따로 쌓인다)
-- ------------------------------------------------------------
create table if not exists public.sent (
  id          uuid primary key default gen_random_uuid(),
  week_start  date not null,
  student_id  uuid not null references public.students(id) on delete cascade,
  via         text not null default 'copy',        -- sms | copy | share | kakao
  sent_by     text not null default '',            -- 누가 보냈는지 (아이디)
  sent_at     timestamptz not null default now(),

  constraint sent_via_check check (via in ('sms','copy','share','kakao'))
);

create unique index if not exists sent_week_student_key on public.sent (week_start, student_id);
create index        if not exists sent_week_idx         on public.sent (week_start);


-- ------------------------------------------------------------
--  7. snippets — 코멘트 상용구
-- ------------------------------------------------------------
create table if not exists public.snippets (
  id          uuid primary key default gen_random_uuid(),
  text        text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),

  constraint snippets_not_blank check (length(btrim(text)) > 0)
);


-- ------------------------------------------------------------
--  8. app_settings — 선생님·조교가 함께 쓰는 설정 (인사말 등)
--     설정이 늘어도 줄만 추가한다. 표를 또 만들지 않는다.
--
--     {호칭} 은 학생마다 다르게 채워진다 (어머님 / 아버님 …)
--     {이름} 은 학생 이름, {링크} 는 레포트 주소로 바뀐다.
-- ------------------------------------------------------------
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  text not null default ''
);

drop trigger if exists app_settings_touch on public.app_settings;
create trigger app_settings_touch before update on public.app_settings
  for each row execute function public.touch_updated_at();

insert into public.app_settings (key, value)
values (
  'greeting',
  jsonb_build_object(
    'sms',   E'안녕하세요 {호칭} 이번 주 레포트 보내드립니다^^\n{링크}',
    'kakao', E'안녕하세요 {호칭} 이번 주 레포트 보내드립니다^^\n{링크}'
  )
)
on conflict (key) do nothing;


-- ------------------------------------------------------------
--  9. class_info — 반마다 적어 둔 값 (반 현황)
--     학생의 students.extra 와 같은 모양이다.
--     반 이름(운유1, 솔터1 …)이 그대로 열쇠다.
--     명단에서 반 이름을 바꾸면 적어 둔 내용은 따라오지 않는다.
--     (week_common 과 같은 방식이다)
-- ------------------------------------------------------------
create table if not exists public.class_info (
  class_name  text primary key,
  extra       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),

  constraint class_info_name_not_blank check (length(btrim(class_name)) > 0)
);


-- ============================================================
--  RLS — 로그인한 사람만 읽고 쓴다
--
--  to authenticated : 로그인한 계정만
--  anon(비로그인) 에게는 아무 정책도 주지 않으므로 전부 막힌다.
-- ============================================================

alter table public.students     enable row level security;
alter table public.field_defs   enable row level security;
alter table public.week_common  enable row level security;
alter table public.entries      enable row level security;
alter table public.published    enable row level security;
alter table public.sent         enable row level security;
alter table public.snippets     enable row level security;
alter table public.app_settings enable row level security;
alter table public.class_info   enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'students','field_defs','week_common','entries','published',
    'sent','snippets','app_settings','class_info'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_authenticated_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_authenticated_all', t
    );
  end loop;
end;
$$;


-- ============================================================
--  확인 — 아래 세 결과를 눈으로 본다
-- ============================================================

-- (1) 표 9개가 전부 rls_enabled = true 여야 한다
select tablename, rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public'
  and tablename in ('students','field_defs','week_common','entries','published',
                    'sent','snippets','app_settings','class_info')
order by tablename;

-- (2) 표마다 정책이 1개씩, roles = {authenticated} 여야 한다
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
order by tablename;

-- (3) 기본 인사말이 들어갔는지
select key, value from public.app_settings where key = 'greeting';
