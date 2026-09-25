-- ============================================================
--  migration-001 — 연락처를 학생/학부모로 나눈다 (1/2 · 옮기기)
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query
--    이 파일 전체를 붙여넣고 Run
--
--  여러 번 실행해도 안전하다.
--
--  이 파일은 '옮기기만' 한다. 옛 칸(parent_phone2)은 그대로 둔다.
--  화면에서 제대로 보이는 것을 확인한 다음에
--  migration-002 를 돌려 옛 칸을 비운다.
--  그때까지는 값이 두 군데에 있으므로 언제든 되돌릴 수 있다.
--
--  규칙
--    parent_phone   (라벨 '어머님')  = 학부모 번호   → 그대로 둔다
--    parent_phone2  (라벨 없음)      = 학생 본인 번호 → student_phone 으로 옮긴다
--    학생 번호가 없는 학생은 student_phone 이 빈 채로 남는다
-- ============================================================


-- ------------------------------------------------------------
--  1. 학생 본인 번호를 담을 칸을 만든다
-- ------------------------------------------------------------
alter table public.students
  add column if not exists student_phone text not null default '';


-- ------------------------------------------------------------
--  2. 옛 '연락처 2' 를 학생 번호로 옮긴다
--
--     이미 student_phone 에 값이 있으면 건드리지 않는다.
--     (두 번 실행해도 덮어쓰지 않게 하기 위함)
-- ------------------------------------------------------------
update public.students
set    student_phone = btrim(parent_phone2)
where  btrim(coalesce(parent_phone2, '')) <> ''
  and  btrim(coalesce(student_phone, '')) = '';


-- ============================================================
--  확인 — 이 결과를 눈으로 본다
--
--  '학생 번호 옮겨짐' + '학생 번호 없음' = 전체 인원이어야 한다.
--  '아직 안 옮겨짐' 이 0 이어야 한다.
-- ============================================================

select
  count(*)                                                          as "전체 인원",
  count(*) filter (where btrim(coalesce(parent_phone, ''))  <> '')  as "학부모 번호 있음",
  count(*) filter (where btrim(coalesce(student_phone, '')) <> '')  as "학생 번호 옮겨짐",
  count(*) filter (where btrim(coalesce(student_phone, ''))  = '')  as "학생 번호 없음",
  count(*) filter (where btrim(coalesce(parent_phone2, '')) <> ''
                     and btrim(coalesce(student_phone, ''))  = '')  as "아직 안 옮겨짐(0이어야 함)",
  count(*) filter (where btrim(coalesce(parent_phone2, '')) <> ''
                     and btrim(coalesce(parent_phone2, ''))
                         <> btrim(coalesce(student_phone, '')))     as "값이 서로 다름(0이어야 함)"
from public.students
where archived = false;
