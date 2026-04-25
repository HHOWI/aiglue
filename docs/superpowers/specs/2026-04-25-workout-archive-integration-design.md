# workout-archive aiglue 통합 설계

**날짜:** 2026-04-25  
**범위:** aiglue `engine.ts` AuthConfig 개선 + workout-archive-be 통합

---

## 1. 배경 및 목표

workout-archive-be(Express + TypeScript, port 3000)에 aiglue를 직접 통합해 자연어로 운동 기록·통계·바디로그·피드·팔로우·댓글·검색을 조회하고 조작할 수 있도록 한다.

**제약 조건:**
- workout-archive-be는 httpOnly 쿠키(`auth_token`) 기반 JWT 인증 사용
- aiglue `handler()`는 `Authorization: Bearer` 헤더만 지원 → 쿠키 인증 불가
- `AuthConfig.token` 함수 타입이 이미 정의되어 있으나 `handler()` 내부에서 미사용 상태

**목표:**
1. aiglue `engine.ts`에서 `config.auth.token` 함수 지원 구현
2. workout-archive-be에 `POST /ai/chat` 엔드포인트 추가 (22개 툴)
3. LLM 프로바이더: Groq (`llama-3.3-70b-versatile`, openai-compatible)

---

## 2. 아키텍처

```
[프론트엔드]
    │  POST /ai/chat  { message, history? }
    │  (쿠키 auth_token 자동 포함)
    ▼
[workout-archive-be :3000]
    ├── AiRouter.ts
    │    └── engine.handler()
    │         └── config.auth.token(req) → req.cookies.auth_token 추출
    │
    │  aiglue 엔진 내부 파이프라인:
    │    1. Groq LLM → intent 분류 / 툴 선택
    │    2. SafetyGate → read/write/critical 분기
    │    3. Executor → HTTP fetch localhost:3000/<endpoint>
    │         Authorization: Bearer <jwt>  ← auth 미들웨어가 수용
    │    4. ResponseFormatter → table/text/confirm/action
    ▼
[프론트엔드]  structured JSON 응답
```

---

## 3. aiglue engine.ts 변경: AuthConfig.token 지원

### 현재 문제

`handler()` 내부가 `req.headers.authorization`만 읽고 `config.auth`를 완전히 무시한다.

### 변경 내용

`handler()` 내에서 토큰 추출 로직을 아래 우선순위로 수정:

1. `config.auth.token`이 함수 → `config.auth.token(req)` 호출
2. `config.auth.token`이 문자열 → 그대로 사용
3. 위 둘 다 없으면 기존대로 `req.headers.authorization`에서 추출

```ts
// handler() 내부 authToken 추출 로직
const authToken: string | undefined = (() => {
  if (config.auth?.token) {
    return typeof config.auth.token === 'function'
      ? config.auth.token(req) ?? undefined
      : config.auth.token
  }
  const rawAuth = req.headers?.authorization
  const authHeader: string | undefined = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth
  return authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader
})()
```

### 테스트 추가

`tests/engine.test.ts`에 두 케이스 추가:
- `config.auth.token`이 함수일 때 호출되어 반환값이 executor로 전달되는지
- `config.auth.token`이 문자열일 때 그대로 사용되는지

---

## 4. workout-archive-be 변경

### 4-1. `src/middlewares/auth.ts` — Bearer fallback 추가

aiglue가 내부 API 호출 시 `Authorization: Bearer <jwt>` 헤더를 사용하므로, 기존 쿠키 전용 미들웨어에 Bearer 헤더도 허용하도록 수정한다.

```ts
// 쿠키 우선, 없으면 Bearer 헤더
const token =
  req.cookies.auth_token ??
  req.headers.authorization?.replace('Bearer ', '')
```

`authenticateToken`과 `optionalAuthenticateToken` 둘 다 동일하게 수정.

### 4-2. `src/routes/AiRouter.ts` — 신규 생성

```ts
import { Router } from 'express'
import { createAIEngine } from '@aiglue/core'
import type { Request } from 'express'
import path from 'path'

const aiRouter = Router()

const engine = createAIEngine({
  tools: path.resolve('./tools.yaml'),
  llm: {
    provider: 'openai-compatible',
    apiKey: process.env.GROQ_API_KEY,
    model: 'llama-3.3-70b-versatile',
    baseUrl: 'https://api.groq.com/openai/v1',
  },
  baseUrl: `http://localhost:${process.env.PORT ?? 3000}`,
  auth: {
    type: 'bearer',
    token: (req) => (req as Request).cookies?.auth_token,
  },
})

aiRouter.post('/chat', engine.handler())

export default aiRouter
```

### 4-3. `src/index.ts` — AiRouter 마운트

```ts
import AiRouter from './routes/AiRouter'
// ...
app.use('/ai', AiRouter)
```

### 4-4. `package.json` — 의존성 추가

로컬 개발 시 파일 경로 의존성 사용 (aiglue 빌드 선행 필요):

```json
"@aiglue/core": "file:../../aiglue/packages/core"
```

설치 전 aiglue 빌드:
```bash
cd ../../aiglue && pnpm build
cd ../workout-archive/workout-archive-be && npm install
```

> 배포 시에는 aiglue가 npm에 퍼블리시된 버전으로 교체.

---

## 5. tools.yaml — 22개 툴

위치: `workout-archive-be/tools.yaml`

### risk_level 기준

| level | 해당 작업 |
|---|---|
| `read` | 조회·검색·통계·피드 |
| `write` | 저장·수정·팔로우·댓글 작성 |
| `critical` | 삭제 |

### response_type 기준

| type | 해당 툴 |
|---|---|
| `table` | 목록형 조회 전체 |
| `table` + `include_summary: true` | 통계 4종 |
| `text` | 단건 상세, 카운트, 액션 결과 |

### 도메인별 툴 목록

#### 운동 기록 (6개)

| 툴 이름 | 엔드포인트 | risk_level | response_type |
|---|---|---|---|
| `get_recent_workout_records` | GET /workouts/workout-records/recent | read | table |
| `get_workout_record_detail` | GET /workouts/profiles/workout-records/:workoutOfTheDaySeq | read | text |
| `get_monthly_workout_dates` | GET /workouts/profiles/:nickname/workout-records/monthly | read | table |
| `update_workout_record` | PUT /workouts/workout-records/:workoutOfTheDaySeq | write | text |
| `delete_workout_record` | DELETE /workouts/workout-records/:workoutOfTheDaySeq | critical | text |
| `toggle_workout_like` | POST /workouts/workout-records/:workoutOfTheDaySeq/like | write | text |

#### 바디로그 (4개)

| 툴 이름 | 엔드포인트 | risk_level | response_type |
|---|---|---|---|
| `get_body_logs` | GET /users/body-logs | read | table |
| `get_latest_body_log` | GET /users/body-logs/latest | read | text |
| `save_body_log` | POST /users/body-logs | write | text |
| `delete_body_log` | DELETE /users/body-logs/:bodyLogSeq | critical | text |

#### 통계 (4개)

| 툴 이름 | 엔드포인트 | risk_level | response_type |
|---|---|---|---|
| `get_body_log_stats` | GET /statistics/body-log-stats | read | table + summary |
| `get_exercise_weight_stats` | GET /statistics/exercise-weight-stats | read | table + summary |
| `get_cardio_stats` | GET /statistics/cardio-stats | read | table + summary |
| `get_body_part_volume_stats` | GET /statistics/body-part-volume-stats | read | table + summary |

#### 피드 (1개)

| 툴 이름 | 엔드포인트 | risk_level | response_type |
|---|---|---|---|
| `get_feed` | GET /feed | read | table |

#### 팔로우 (5개)

| 툴 이름 | 엔드포인트 | risk_level | response_type |
|---|---|---|---|
| `follow_user` | POST /follow/user | write | text |
| `unfollow_user` | DELETE /follow/user/:followingUserSeq | write | text |
| `get_followers` | GET /follow/followers/:userSeq | read | table |
| `get_following` | GET /follow/following/:userSeq | read | table |
| `get_follow_counts` | GET /follow/counts/:userSeq | read | text |

#### 댓글 (4개)

| 툴 이름 | 엔드포인트 | risk_level | response_type |
|---|---|---|---|
| `get_comments` | GET /workouts/:workoutOfTheDaySeq/comments | read | table |
| `create_comment` | POST /workouts/:workoutOfTheDaySeq/comments | write | text |
| `update_comment` | PUT /workouts/comments/:commentSeq | write | text |
| `delete_comment` | DELETE /workouts/comments/:commentSeq | critical | text |

#### 검색 (2개)

| 툴 이름 | 엔드포인트 | risk_level | response_type |
|---|---|---|---|
| `search_users` | GET /search/users | read | table |
| `search_places` | GET /search/places | read | table |

---

## 6. 변경 파일 요약

| 파일 | 작업 | 프로젝트 |
|---|---|---|
| `packages/core/src/engine.ts` | `config.auth.token` 함수 지원 구현 | aiglue |
| `packages/core/tests/engine.test.ts` | AuthConfig.token 테스트 2케이스 추가 | aiglue |
| `src/middlewares/auth.ts` | Bearer 헤더 fallback 추가 | workout-archive-be |
| `src/routes/AiRouter.ts` | 신규 생성 | workout-archive-be |
| `tools.yaml` | 22개 툴 정의 | workout-archive-be |
| `src/index.ts` | AiRouter 마운트, `app.use('/ai', AiRouter)` | workout-archive-be |
| `package.json` | `@aiglue/core` 의존성 추가 | workout-archive-be |

---

## 7. 제외 항목

- 운동 기록 저장(`POST /workouts/workout-records`): 이미지 업로드 필요, 자연어 인터페이스 부적합
- 댓글 좋아요 토글: 너무 세분화된 액션
- 대댓글 조회: 복잡한 중첩 구조
- 장소 팔로우/언팔로우: 사용 빈도 낮음
- 로그인·로그아웃·회원가입: 기존 UI 전담
- 프로필 이미지 업로드: 파일 업로드 필요
