# 읽지 않고 먹습니다 · Read Less, Eat More

지점 주변에서 **걸어서 갈 만한 점심 식당**을 모아 보여 주고, 고르기 어려우면 **오늘 갈 곳을 뽑아 주는** 사이트입니다.

- 지도에서 지점을 고르거나(목록으로 바꿔 보기 가능) → 아래에 분류 탭과 식당 카드 목록
- 점심(평일 12~13시)에 영업하는 곳 위주로 보기
- 네이버 블로그 리뷰 수 · 최근 리뷰, 네이버 지도(평점·방문자 리뷰) 바로가기
- Claude 가 블로그 글을 읽고 **신규 오픈 · 이벤트 · 할인 · 시즌 메뉴 · 신메뉴 · 점심 특선** 배지와 한 줄 요약을 붙임
- 🎲 랜덤 뽑기 (최근 간 곳 빼기, 리뷰 많은 곳 가중치), 오늘의 팀 공통 추천, 메신저 공유
- AI 점심 소믈리에: "비 오는 날 뜨끈한 국물, 1만원 이하" 같은 말로 3곳 추천

샘플 화면: 배포 주소 뒤에 `?demo=1` 을 붙이면 API 키 없이 가짜 데이터로 화면을 볼 수 있습니다.

## 구조

```
┌──────────── GitHub Actions (평일 06:40 KST) ────────────┐
│ pipeline/collect.ts                                     │
│  카카오 로컬 API ── 반경 1km 음식점 목록                    │
│  네이버 검색 API ── 블로그 리뷰 수 · 최신 글 10개            │
│  Google Places ─── (선택) 별점 · 영업시간 · 폐업 여부        │
│  Claude API ────── 최신 글 → 새 소식 배지 · 요약 · 점심 정보 │
│        ↓ public/data/places/{지점코드}.json 커밋            │
└─────────────────────────┬───────────────────────────────┘
                          ↓ 배포
┌──────────── Cloudflare Workers ─────────────────────────┐
│ 정적 화면(React + Leaflet) + 데이터 JSON                  │
│ /api/ask  AI 점심 소믈리에 (Claude)                        │
└─────────────────────────────────────────────────────────┘
```

| 폴더 | 내용 |
| --- | --- |
| `src/` | 화면 (React, Leaflet 지도) |
| `docs/` | Claude API 로 더 해 볼 만한 기능 |
| `worker/` | Cloudflare Worker (`/api/config`, `/api/ask`) |
| `pipeline/` | 데이터 수집 (`collect.ts`), 지점 엑셀 가져오기 (`import-branches.ts`) |
| `shared/` | 화면·워커·수집이 같이 쓰는 타입과 규칙 (분류, 거리, 점심 판정, 배지 만료) |
| `public/data/` | `branches.json` (지점 34곳), `index.json`, `places/*.json` (수집 결과) |

## 데이터는 어떻게 판단하나요

| 항목 | 출처 | 비고 |
| --- | --- | --- |
| 식당 목록 · 분류 · 거리 | 카카오 로컬 (카테고리 FD6) | 반경 안을 4등분하며 훑어 45개 제한을 넘김. 지점당 가까운 400곳 |
| 도보 시간 | 직선거리 × 1.25 ÷ 분속 70m | 5 / 10 / 15분 필터 |
| 블로그 리뷰 수 | 네이버 블로그 검색 「가게 이름 + 동」 결과 수 | 인기 지표 (네이버 지도의 '블로그 리뷰' 수와는 다를 수 있음) |
| 평점 · 방문자 리뷰 | 네이버 지도 링크 | **네이버 플레이스 평점은 공식 API 가 없어** 카드에서 바로 연결 |
| 점심 영업 | ① Google 영업시간 ② Claude 가 리뷰에서 찾은 점심 영업 근거 ③ 주점 분류는 저녁 위주로 봄 | '점심 영업하는 곳만' 은 점심에 안 열 가능성이 큰 곳과 휴업만 숨김 |
| 신규 오픈 · 이벤트 · 시즌 메뉴 | Claude 가 최신 블로그 글에서 근거와 날짜를 뽑음 | 근거 날짜가 지나면 화면에서 자동으로 숨김 (이벤트 45일, 신규 오픈 90일 등) |
| 지도 신규 등록 | 첫 수집 이후 카카오맵에 새로 보인 가게 | 60일간 NEW 표시 |

## 시작하기

### 1. API 키 준비

| 이름 | 어디서 | 필수 | 비용 |
| --- | --- | --- | --- |
| `KAKAO_REST_API_KEY` | [Kakao Developers](https://developers.kakao.com) → 앱 만들기 → 앱 키의 **REST API 키** (앱 설정에서 「카카오맵」 사용을 켜야 할 수 있음) | ✅ | 무료 한도 안 |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | [NAVER Developers](https://developers.naver.com/apps) → 애플리케이션 등록 → 사용 API 「검색」 | 권장 | 무료 (하루 25,000회) |
| `ANTHROPIC_API_KEY` | [Claude Console](https://platform.claude.com) → API Keys | 권장 | 아래 '비용' 참고 |
| `GOOGLE_PLACES_API_KEY` | Google Cloud → Places API (New) | 선택 | 별점·영업시간 필드는 유료 (월 무료 한도 있음) |

### 2. GitHub 에 등록

저장소 **Settings → Secrets and variables → Actions**

- **Secrets**: 위 키들 + `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- **Variables** (선택)

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `CLAUDE_MODEL` | `claude-opus-5-5` | 비용을 줄이려면 `claude-haiku-5-5` |
| `AI_MAX_PLACES_PER_RUN` | `300` | 하루에 Claude 로 분석할 최대 식당 수 |
| `RADIUS_M` | `1000` | 수집 반경 (m) |
| `MAX_PLACES_PER_BRANCH` | `400` | 지점당 최대 식당 수 (가까운 순) |
| `GOOGLE_MAX_PER_BRANCH` | `0` | 지점마다 인기 상위 N곳만 Google 조회 (0 = 끔) |

### 3. Cloudflare 배포

1. Cloudflare 대시보드 → 오른쪽 위 프로필 → **API Tokens → Create Token → 「Edit Cloudflare Workers」 템플릿**
   - Account Resources: 내 계정 / Zone Resources: 연결할 도메인(있다면)
2. 대시보드 Workers 화면 오른쪽의 **Account ID** 를 복사
3. 두 값을 GitHub Secrets 에 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` 로 저장
4. `main` 브랜치에 push 하면 `Deploy` 워크플로가 `https://read-less-eat-more.<계정>.workers.dev` 로 배포
5. **Actions → 식당 데이터 수집 → Run workflow** 로 첫 수집 (처음엔 `ai_budget` 을 크게 잡으면 빨리 채워짐)

#### 내 도메인 연결

도메인이 Cloudflare 에 등록(네임서버 연결)되어 있다면 `wrangler.jsonc` 의 주석을 풀고 바꾸세요.

```jsonc
"routes": [{ "pattern": "lunch.example.com", "custom_domain": true }],
```

배포하면 DNS 레코드와 인증서가 자동으로 만들어집니다. (API 토큰에 해당 Zone 권한 필요)

#### 사내에서만 보이게

Cloudflare **Zero Trust → Access → Applications** 에서 도메인을 등록하고 회사 이메일 도메인만 허용하면 됩니다 (50명까지 무료).

## 로컬 개발

```bash
npm install
npm run dev                 # http://localhost:5173/?demo=1  (샘플 데이터)
npm run check               # 타입 검사 + 테스트 + 빌드

# 실제 데이터 수집 (한 지점만)
cp .env.example .env        # 키 입력
set -a; . ./.env; set +a
BRANCHES=001 npm run collect

# 워커까지 같이 (AI 소믈리에 확인)
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .dev.vars
npm run preview             # http://localhost:8787
```

### 지점 목록 바꾸기

BookGrid 에서 지점 주소 엑셀을 새로 받으면:

```bash
npm run import:branches -- ~/Downloads/BookGrid_지점주소.xlsx
```

`지점 주소 (수불처)` 시트에서 위도·경도가 있는 줄만 `public/data/branches.json` 으로 옮깁니다 (엑셀 원본은 커밋하지 않음).

## 비용

- 카카오 · 네이버: 무료 한도 안에서 동작 (하루 카카오 수천 회, 네이버 최대 20,000회로 제한)
- Claude: **새 블로그 글에 이벤트·신메뉴 같은 말이 보일 때만** 다시 분석하고, 하루 최대 `AI_MAX_PLACES_PER_RUN` 곳까지만 분석합니다. 8곳씩 묶어 한 번에 요청합니다.
  - 기본 모델 `claude-opus-5-5` 기준 대략 식당 1곳당 1센트 안팎 → 하루 300곳이면 약 $3
  - `claude-haiku-5-5` 로 바꾸면 수십 배 저렴합니다 (`CLAUDE_MODEL` 변수)
- AI 소믈리에(`/api/ask`)는 IP 당 1분 10회로 제한되어 있습니다.
- Cloudflare Workers 무료 요금제로 충분합니다.

## 한계와 메모

- 네이버 지도(플레이스)의 별점·방문자 리뷰·영업시간은 공식 API 가 없어 직접 가져오지 않습니다 (자동 수집은 이용약관 위반 소지 + 클라우드 IP 차단). 대신 카드마다 네이버 지도 바로가기를 둡니다.
- 블로그 리뷰 수는 「가게 이름 + 동」 검색 결과라 이름이 흔한 가게는 부풀 수 있습니다.
- AI 요약·배지는 블로그 글을 바탕으로 자동 생성되어 틀릴 수 있습니다.
- 지도는 OpenStreetMap 타일을 씁니다. 다른 타일을 쓰려면 빌드 시 `VITE_TILE_URL`, `VITE_TILE_ATTRIBUTION` 을 지정하세요.
