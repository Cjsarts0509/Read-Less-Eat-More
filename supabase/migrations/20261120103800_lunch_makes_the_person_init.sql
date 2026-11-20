-- 점심은 사람을 만든다 (Lunch Makes the Person) — 팀 투표방 · 메뉴판 사진 제보
-- Supabase 프로젝트 Cjs0509arts 에 2026-11-20 적용함.
-- 브라우저는 직접 읽지 않는다. Cloudflare Worker 가 secret key 로만 읽고 쓴다 (RLS 켜고 정책 없음).

create table if not exists public.lunch_rooms (
  code text primary key check (code ~ '^[A-Z0-9]{6}$'),
  branch_code text not null check (char_length(branch_code) between 1 and 16),
  title text not null default '' check (char_length(title) <= 40),
  deadline timestamptz,
  candidates jsonb not null default '[]'::jsonb,
  mediation jsonb,
  decided_place_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.lunch_rooms is '점심 팀 투표방. candidates = AI 사서 중재 결과 [{id, reason, notes:[{nickname, note}]}]. 14일 지나면 지운다';

create table if not exists public.lunch_room_members (
  id bigint generated always as identity primary key,
  room_code text not null references public.lunch_rooms(code) on delete cascade,
  member_key text not null check (char_length(member_key) between 8 and 64),
  nickname text not null check (char_length(nickname) between 1 and 20),
  prefs jsonb not null default '{}'::jsonb,
  vote_place_id text,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_code, member_key)
);
comment on table public.lunch_room_members is '투표방 참여자. 로그인 없이 브라우저가 만든 member_key + 닉네임. prefs = {want, avoid, budget, maxWalk}';
create index if not exists lunch_room_members_room_idx on public.lunch_room_members (room_code);

create table if not exists public.lunch_menu_reports (
  id bigint generated always as identity primary key,
  branch_code text not null check (char_length(branch_code) between 1 and 16),
  place_id text not null check (char_length(place_id) between 1 and 64),
  place_name text not null default '',
  nickname text check (char_length(nickname) <= 20),
  image_path text,
  items jsonb not null default '[]'::jsonb,
  note text,
  model text,
  status text not null default 'visible' check (status in ('visible', 'hidden')),
  created_at timestamptz not null default now()
);
comment on table public.lunch_menu_reports is '직원이 올린 메뉴판 사진에서 Claude 가 뽑은 메뉴·가격. 사진은 storage lunch-menus 버킷(비공개). 가리려면 status=hidden';
create index if not exists lunch_menu_reports_place_idx on public.lunch_menu_reports (branch_code, place_id, created_at desc);

alter table public.lunch_rooms enable row level security;
alter table public.lunch_room_members enable row level security;
alter table public.lunch_menu_reports enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lunch-menus', 'lunch-menus', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
