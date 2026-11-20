-- 오늘의 밸런스 게임 투표 (하루 한 질문, 한 사람 한 표 · 바꾸면 고쳐짐)
-- 브라우저는 직접 읽지 않는다. Cloudflare Worker 가 secret key 로만 읽고 쓴다 (RLS 켜고 정책 없음).

create table if not exists public.lunch_balance_votes (
  day date not null,
  member_key text not null check (char_length(member_key) between 8 and 64),
  choice text not null check (choice in ('a', 'b')),
  updated_at timestamptz not null default now(),
  primary key (day, member_key)
);
comment on table public.lunch_balance_votes is '오늘의 밸런스 게임 투표 (하루 한 질문, 한 사람 한 표 · 바꾸면 고쳐짐). 30일 지나면 지운다';

alter table public.lunch_balance_votes enable row level security;
