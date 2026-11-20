-- 상세 화면에서 AI 웹 조사로 확인한 영업시간 · 메뉴 (가게당 한 줄, 여러 사람이 함께 쓰는 캐시)
-- 브라우저는 직접 읽지 않는다. Cloudflare Worker 가 secret key 로만 읽고 쓴다 (RLS 켜고 정책 없음).

create table if not exists public.lunch_place_live (
  place_id text primary key check (char_length(place_id) between 1 and 32),
  branch_code text not null check (char_length(branch_code) between 1 and 16),
  status text not null default 'done' check (status in ('pending', 'done', 'notfound', 'error')),
  data jsonb,
  checked_at timestamptz not null default now()
);
comment on table public.lunch_place_live is '상세 화면 실시간 확인 결과 (AI 웹 검색). data = WebInfo. 14일 지나면 다시 확인. 하루 확인 수는 checked_at 으로 센다';
create index if not exists lunch_place_live_checked_idx on public.lunch_place_live (checked_at);

alter table public.lunch_place_live enable row level security;
