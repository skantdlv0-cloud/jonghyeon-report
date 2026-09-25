-- ============================================================
--  확인용 — 주차가 어떻게 갈렸는지 본다
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query
--    이 파일 전체를 붙여넣고 Run
--
--  아무것도 바꾸지 않는다. 읽기만 한다. 몇 번을 돌려도 안전하다.
--
--  보는 것
--    · 어떤 주차들이 서버에 있는지
--    · 반마다 종료일이 어떻게 적혀 있는지  ← 날짜 버그의 핵심
--    · 주차마다 작성·발행·발송이 몇 건인지
-- ============================================================

with weeks as (
  select week_start from public.week_common
  union
  select week_start from public.entries
  union
  select week_start from public.published
  union
  select week_start from public.sent
)
select
  to_char(w.week_start, 'YYYY-MM-DD')                       as "주차 시작일",
  to_char(w.week_start, 'Dy')                               as "무슨 요일",

  /* 반마다 종료일이 따로 저장된다. 여기가 갈리면 레포트 날짜가 반마다 달라진다. */
  coalesce((
    select string_agg(wc.class_name || ' → ' || to_char(wc.week_end, 'MM/DD'),
                      '  ·  ' order by wc.class_name)
    from public.week_common wc
    where wc.week_start = w.week_start
  ), '(반 공통 없음 — 종료일이 서버에 없다)')                as "반별 종료일",

  (select count(*) from public.week_common wc
     where wc.week_start = w.week_start)                    as "반 공통 줄",

  (select count(*) from public.entries e
     where e.week_start = w.week_start)                     as "작성 줄",

  (select count(*) from public.entries e
     where e.week_start = w.week_start
       and btrim(coalesce(e.attend_status, '')) <> '')      as "출결 고른 학생",

  (select count(*) from public.published p
     where p.week_start = w.week_start)                     as "발행",

  (select count(*) from public.sent s
     where s.week_start = w.week_start)                     as "보냄",

  /* 발행 경로 맨 앞 네 자리(월일). 깃허브의 파일 이름과 같아야 한다. */
  coalesce((
    select string_agg(distinct substring(p.path from 9 for 4), ', ')
    from public.published p
    where p.week_start = w.week_start
  ), '-')                                                   as "발행 파일명 날짜"

from weeks w
order by w.week_start;
