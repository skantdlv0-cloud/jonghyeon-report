-- ============================================================
--  migration-002 — 연락처를 학생/학부모로 나눈다 (2/2 · 옛 칸 비우기)
--
--  ⚠ migration-001 을 돌리고,
--    ① 명단 탭에서 42명의 '학생 연락처' 가 제대로 보이는 것을
--    눈으로 확인한 다음에만 실행한다.
--
--  이 파일은 옛 칸(parent_phone2)을 비운다.
--  여기까지 오면 학생 번호는 student_phone 한 군데에만 남는다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query
--    이 파일 전체를 붙여넣고 Run
--
--  여러 번 실행해도 안전하다.
-- ============================================================


-- ------------------------------------------------------------
--  안전장치 — 안 옮겨진 값이 하나라도 있으면 멈춘다
--
--  student_phone 이 비었는데 parent_phone2 에 번호가 있으면
--  지금 비우는 순간 그 번호가 사라진다. 그런 줄이 있으면
--  아무것도 하지 않고 오류를 내어 알려 준다.
-- ------------------------------------------------------------
do $$
declare
  n integer;
begin
  select count(*) into n
  from public.students
  where btrim(coalesce(parent_phone2, '')) <> ''
    and btrim(coalesce(parent_phone2, '')) <> btrim(coalesce(student_phone, ''));

  if n > 0 then
    raise exception
      '아직 옮겨지지 않은 번호가 %건 있습니다. migration-001 을 먼저 실행하세요. (아무것도 바꾸지 않았습니다)', n;
  end if;
end;
$$;


-- ------------------------------------------------------------
--  옛 칸 비우기
-- ------------------------------------------------------------
update public.students
set    parent_phone2 = ''
where  btrim(coalesce(parent_phone2, '')) <> '';


-- ============================================================
--  확인 — '옛 칸에 남은 번호' 가 0 이어야 한다
-- ============================================================

select
  count(*)                                                          as "전체 인원",
  count(*) filter (where btrim(coalesce(parent_phone, ''))  <> '')  as "학부모 번호",
  count(*) filter (where btrim(coalesce(student_phone, '')) <> '')  as "학생 번호",
  count(*) filter (where btrim(coalesce(parent_phone2, '')) <> '')  as "옛 칸에 남은 번호(0이어야 함)"
from public.students
where archived = false;
