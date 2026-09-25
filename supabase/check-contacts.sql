-- ============================================================
--  확인용 — 연락처를 학생/학부모로 나누기 전에 42명을 먼저 본다
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query
--    이 파일 전체를 붙여넣고 Run
--
--  아무것도 바꾸지 않는다. 읽기만 한다. 몇 번을 돌려도 안전하다.
--
--  규칙 (선생님이 알려 주신 것)
--    · 라벨이 붙은 번호(연락처 1)  = 학부모 번호
--    · 라벨 없는 번호(연락처 2)    = 학생 본인 번호
--    · 학생 번호가 없는 학생도 있다 → 그건 비워 두면 된다
--
--  번호는 가운데를 가려서 보여 준다 (010-****-5678).
--  뒤 네 자리만으로 어느 학생인지 알아보기에 충분하고,
--  결과를 그대로 옮겨 적어도 번호가 통째로 새지 않는다.
--
--  판정 칸에 ⚠ 가 붙은 줄만 보면 된다.
--  ⚠ 가 하나도 없으면 규칙대로 그대로 옮겨도 안전하다는 뜻이다.
-- ============================================================

with s as (
  select
    name,
    class_name,
    btrim(coalesce(parent_title, ''))                              as 라벨원본,
    regexp_replace(coalesce(parent_phone,  ''), '[^0-9]', '', 'g') as p1,
    regexp_replace(coalesce(parent_phone2, ''), '[^0-9]', '', 'g') as p2
  from public.students
  where archived = false
),
j as (
  select
    s.*,
    case
      when p1 = '' and p2 = ''
        then '번호가 아예 없음'
      when p1 = '' and p2 <> ''
        then '⚠ 학부모 칸이 비었는데 연락처2만 있음 (뒤바뀐 것일 수 있음)'
      when length(p1) not in (10, 11)
        then '⚠ 학부모 번호 자릿수가 이상함 (' || length(p1) || '자리) — 한 칸에 번호 두 개?'
      when p2 <> '' and length(p2) not in (10, 11)
        then '⚠ 연락처2 자릿수가 이상함 (' || length(p2) || '자리) — 한 칸에 번호 두 개?'
      when p2 <> '' and p1 = p2
        then '⚠ 두 칸이 같은 번호'
      when 라벨원본 not in ('', '어머님')
        then '⚠ 라벨이 어머님이 아님 (' || 라벨원본 || ')'
      when p2 = ''
        then 'OK · 학생 번호 없음 → 비워 둠'
      else
        'OK · 연락처2 를 학생 번호로 옮김'
    end as 판정
  from s
)
select
  case when 판정 like '⚠%' then 1
       when 판정 like '번호가%' then 2
       else 3 end                                    as 순서,
  name                                               as 이름,
  nullif(class_name, '')                             as 반,
  case when 라벨원본 = '' then '(라벨 없음 → 화면에는 어머님)' else 라벨원본 end as 라벨,
  case when p1 = ''            then '(없음)'
       when length(p1) >= 7    then left(p1, 3) || '-****-' || right(p1, 4)
       else p1 end                                   as "학부모 번호 (연락처1)",
  case when p2 = ''            then '(없음)'
       when length(p2) >= 7    then left(p2, 3) || '-****-' || right(p2, 4)
       else p2 end                                   as "학생 번호로 옮길 것 (연락처2)",
  판정
from j
order by 순서, coalesce(class_name, ''), name;
