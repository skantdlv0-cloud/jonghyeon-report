-- ============================================================
--  migration-004 — 반 공통 코멘트
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query
--    이 파일 전체를 붙여넣고 Run
--
--  여러 번 실행해도 안전하다. 기존 자료는 지우지 않는다.
--
--  무엇이 바뀌나
--
--  반 공통 칸(그 주, 그 반)에 코멘트를 한 번 적으면 그 반 학생
--  전원의 레포트에 똑같이 들어간다. 특정 학생만 따로 쓰고 싶으면
--  그 학생 코멘트를 적으면 되고, 다시 비우면 공통으로 돌아간다.
--
--    entries.comment 가 비어 있다  → 반 공통 코멘트를 쓴다
--    entries.comment 에 글이 있다  → 그 학생 것을 쓴다
--
--  entries.comment 는 건드리지 않는다. 지금 적혀 있는 개별 코멘트는
--  그대로 '개별' 로 남는다.
-- ============================================================

alter table public.week_common
  add column if not exists comment text not null default '';


-- ============================================================
--  확인 — 칸이 생겼는지, 지금 개별 코멘트가 몇 건인지 본다
--
--  '반 공통 코멘트 적힌 반' 은 지금은 0 이 정상이다.
--  아직 아무 데도 안 적었기 때문이다.
-- ============================================================

select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'week_common'
       and column_name = 'comment')                                as "칸 생김(1이어야 함)",
  (select count(*) from public.week_common
     where btrim(coalesce(comment, '')) <> '')                     as "반 공통 코멘트 적힌 반",
  (select count(*) from public.week_common)                        as "반 공통 줄 전체",
  (select count(*) from public.entries
     where btrim(coalesce(comment, '')) <> '')                     as "개별 코멘트 적힌 학생",
  (select count(*) from public.entries)                            as "작성 줄 전체";
