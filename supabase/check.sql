-- ============================================================
--  확인용 — schema.sql 이 잘 실행됐는지 본다
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query
--    이 파일 전체를 붙여넣고 Run
--
--  아무것도 바꾸지 않는다. 읽기만 한다. 몇 번을 돌려도 안전하다.
--
--  결과가 세 줄 나온다. 판정 칸이 셋 다 'OK' 여야 한다.
--
--     순서  항목                      결과     판정
--     ----  ------------------------  -------  ----
--      1    표가 만들어졌나            9 / 9    OK
--      2    자물쇠(RLS)가 켜졌나       9 / 9    OK
--      3    로그인한 사람만 보는 규칙   9 / 9    OK
--
--  하나라도 'OK 아님' 이면 schema.sql 을 다시 한 번 Run 한다.
--  (여러 번 실행해도 자료가 지워지지 않는다)
-- ============================================================

with want(name) as (
  values ('students'), ('field_defs'), ('week_common'), ('entries'),
         ('published'), ('sent'), ('snippets'), ('app_settings'), ('class_info')
),
have as (
  select tablename, rowsecurity
  from pg_tables
  where schemaname = 'public'
    and tablename in (select name from want)
),
pol as (
  select distinct tablename
  from pg_policies
  where schemaname = 'public'
    and tablename in (select name from want)
    and roles::text = '{authenticated}'
)
select 순서, 항목, 결과, 판정 from (

  select 1 as 순서,
         '표가 만들어졌나' as 항목,
         (select count(*) from have)::text || ' / 9' as 결과,
         case when (select count(*) from have) = 9
              then 'OK' else 'OK 아님 — schema.sql 다시 Run' end as 판정

  union all
  select 2,
         '자물쇠(RLS)가 켜졌나',
         (select count(*) from have where rowsecurity)::text || ' / 9',
         case when (select count(*) from have where rowsecurity) = 9
              then 'OK' else 'OK 아님 — schema.sql 다시 Run' end

  union all
  select 3,
         '로그인한 사람만 보는 규칙',
         (select count(*) from pol)::text || ' / 9',
         case when (select count(*) from pol) = 9
              then 'OK' else 'OK 아님 — schema.sql 다시 Run' end

) x
order by 순서;
