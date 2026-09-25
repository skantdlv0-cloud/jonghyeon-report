-- ============================================================
--  migration-005 — 과제를 필수/선택 항목으로
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query
--    이 파일 전체를 붙여넣고 Run
--
--  여러 번 실행해도 안전하다. 기존 자료는 지우지 않는다.
--
--  무엇이 바뀌나
--
--  과제가 '월화수목금 요일 체크' 에서 '이름을 직접 적는 항목' 으로 바뀐다.
--  리뷰테스트와 같은 방식이다. 반 공통에 이름을 적고, 학생마다 체크한다.
--
--    week_common.homework   반 공통에 적는 과제 목록 (새 칸)
--      [{"key":"h1","group":"required","name":"문학 주간지"},
--       {"key":"h2","group":"required","name":"독서 주간지"},
--       {"key":"h3","group":"optional","name":"기출 추가문제"},
--       {"key":"h4","group":"optional","name":"오답 정리"}]
--
--    entries.homework       학생이 한 것 (칸은 그대로, 담기는 내용이 바뀐다)
--      예전: {"월":true,"화":true}        요일
--      앞으로: {"h1":true,"h3":false}     항목 key
--
--  entries.homework 는 손대지 않는다. 지난 주차에 적힌 요일 체크는
--  그대로 남는다. 화면과 레포트가 옛 모양도 읽을 줄 알기 때문에
--  지난 주차를 열어도 그대로 보인다.
--
--  이미 발행한 레포트는 자기 안에 그릴 코드를 통째로 담고 있어서
--  이 변경과 무관하게 지금 모습 그대로 열린다.
-- ============================================================

alter table public.week_common
  add column if not exists homework jsonb not null default '[]'::jsonb;


-- ============================================================
--  확인 — 칸이 생겼는지, 옛 요일 자료가 몇 건인지 본다
--
--  '옛 요일 방식 작성 줄' 은 지난 주차 것이다. 그대로 두면 된다.
--  '새 항목 방식 작성 줄' 은 지금은 0 이 정상이다.
-- ============================================================

select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'week_common'
       and column_name = 'homework')                          as "칸 생김(1이어야 함)",

  (select count(*) from public.week_common
     where jsonb_array_length(coalesce(homework, '[]'::jsonb)) > 0)
                                                              as "과제 목록 적힌 반",

  (select count(*) from public.entries e
     where exists (
       select 1 from jsonb_object_keys(coalesce(e.homework, '{}'::jsonb)) k
       where k in ('월','화','수','목','금')))                 as "옛 요일 방식 작성 줄",

  (select count(*) from public.entries e
     where exists (
       select 1 from jsonb_object_keys(coalesce(e.homework, '{}'::jsonb)) k
       where k like 'h%'))                                    as "새 항목 방식 작성 줄",

  (select count(*) from public.entries)                       as "작성 줄 전체";
