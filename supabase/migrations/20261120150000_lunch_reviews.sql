-- 사내 한줄평 · 별점 (사내 베스트셀러). 로그인 없이 브라우저 member_key + 닉네임.
-- 브라우저는 직접 읽지 않는다. Cloudflare Worker 가 secret key 로만 읽고 쓴다 (RLS 켜고 정책 없음).

create table if not exists public.lunch_reviews (
  id bigint generated always as identity primary key,
  branch_code text not null check (char_length(branch_code) between 1 and 16),
  place_id text not null check (char_length(place_id) between 1 and 64),
  member_key text not null check (char_length(member_key) between 8 and 64),
  nickname text not null check (char_length(nickname) between 1 and 20),
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (place_id, member_key)
);
comment on table public.lunch_reviews is '사내 한줄평 · 별점. 로그인 없이 브라우저 member_key + 닉네임, 가게마다 한 사람 한 줄 (다시 쓰면 고쳐짐)';
create index if not exists lunch_reviews_branch_idx on public.lunch_reviews (branch_code, updated_at desc);

alter table public.lunch_reviews enable row level security;
