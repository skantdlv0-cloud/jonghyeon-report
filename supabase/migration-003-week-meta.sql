-- ============================================================
--  migration-003 — 주차 종료일을 주차마다 하나로 모은다
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query
--    이 파일 전체를 붙여넣고 Run
--
--  여러 번 실행해도 안전하다. 기존 자료는 지우지 않는다.
--
--  왜 만드나
--
--  지금 종료일(week_end)은 week_common 에만 있다. week_common 은
--  '그 주, 그 반' 마다 한 줄이라 종료일도 반마다 따로 저장됐다.
--  그래서 두 가지가 어긋났다.
--
--    1. 반 공통(차시·테스트 이름)을 아직 안 적은 반은 줄이 안 생겨서
--       종료일이 아예 서버에 올라가지 않았다. 새로고침하면 그 주
--       금요일로 되돌아갔다.
--    2. 반이 여럿이면 어느 반 값이 이기는지 정해져 있지 않았다.
--
--  종료일은 '그 주' 의 성질이지 '그 반' 의 성질이 아니다.
--  그래서 주차마다 한 줄인 표로 옮긴다.
--
--  week_common.week_end 는 지우지 않는다. 옛 기기가 아직 그걸
--  쓰고 있을 수 있고, 지워서 얻는 것이 없다.
-- ============================================================


-- ------------------------------------------------------------
--  1. 주차마다 한 줄
-- ------------------------------------------------------------
create table if not exists public.week_meta (
  week_start  date primary key,
  week_end    date not null,
  updated_at  timestamptz not null default now(),

  -- 종료일이 시작일보다 빠를 수 없다. 화면에서도 막지만 서버에서도 막는다.
  constraint week_meta_order check (week_end >= week_start)
);

drop trigger if exists week_meta_touch on public.week_meta;
create trigger week_meta_touch before update on public.week_meta
  for each row execute function public.touch_updated_at();


-- ------------------------------------------------------------
--  2. 로그인한 사람만 읽고 쓴다 (다른 표와 같은 규칙)
-- ------------------------------------------------------------
alter table public.week_meta enable row level security;

drop policy if exists week_meta_authenticated_all on public.week_meta;
create policy week_meta_authenticated_all
  on public.week_meta for all to authenticated
  using (true) with check (true);


-- ------------------------------------------------------------
--  3. week_common 에 흩어져 있던 종료일을 옮긴다
--
--     반마다 다르면 가장 늦은 날짜를 쓴다. 주차를 짧게 잡아
--     수업한 날이 빠지는 것보다, 길게 잡히는 편이 덜 위험하다.
--     종료일이 시작일보다 빠른(뒤집힌) 줄은 가져오지 않는다.
--     그런 주차는 화면에서 새로 골라 주면 된다.
-- ------------------------------------------------------------
insert into public.week_meta (week_start, week_end)
select week_start, max(week_end)
from   public.week_common
where  week_end >= week_start
group  by week_start
on conflict (week_start) do nothing;


-- ============================================================
--  확인 — 주차마다 종료일이 하나씩 잡혔는지 본다
--
--  '반별 종료일' 이 여러 개로 갈려 있어도
--  '이제 쓰는 종료일' 은 하나여야 한다.
--  뒤집힌 주차는 '(없음 — 화면에서 골라 주세요)' 로 나온다.
-- ============================================================

with weeks as (
  select week_start from public.week_common
  union select week_start from public.entries
  union select week_start from public.week_meta
)
select
  to_char(w.week_start, 'YYYY-MM-DD')                        as "주차 시작일",
  coalesce((
    select string_agg(wc.class_name || ' → ' || to_char(wc.week_end, 'MM/DD'),
                      '  ·  ' order by wc.class_name)
    from public.week_common wc where wc.week_start = w.week_start
  ), '-')                                                    as "옛 반별 종료일",
  coalesce((
    select to_char(m.week_end, 'YYYY-MM-DD')
    from public.week_meta m where m.week_start = w.week_start
  ), '(없음 — 화면에서 골라 주세요)')                          as "이제 쓰는 종료일",
  (select count(*) from public.entries e
     where e.week_start = w.week_start)                      as "작성 줄"
from weeks w
order by w.week_start;
