---
name: aiglue
description: Use when authoring or editing aiglue tools.yaml — the file that maps natural-language intents to REST endpoints for the @aiglue/core runtime.
---

# aiglue tools.yaml 작성 지침

이 스킬은 `tools.yaml`에 도구 정의를 **추가·수정·검증**할 때 사용합니다. `@aiglue/core` 런타임은 이 파일을 whitelist·LLM 프롬프트·실행기의 유일한 소스로 사용합니다.

## 작업 시작 전

1. 프로젝트 루트에 `tools.yaml`이 있는지 확인. 없으면 `node_modules/@aiglue/core/assets/tools.skeleton.yaml`을 복사.
2. 스키마 원본: `node_modules/@aiglue/core/schema/tools.schema.json` — 애매하면 이걸 열어 검증.
3. 작업 완료 후 `npx aiglue lint tools.yaml` 실행.

## 도구 하나 정의하는 방법

새 엔드포인트마다 `tools:` 배열에 객체 하나를 추가합니다. 필수 필드는 `name`, `description`, `endpoint`.

```yaml
- name: get_workout_logs
  description: "운동 기록을 조회한다. 날짜·종목·세트·무게 포함."
  endpoint: GET /api/workouts
  params:
    startDate:
      description: "시작 날짜 (YYYY-MM-DD)"
      type: string
      required: false
  response_type: table
  risk_level: read
  columns:
    - { key: "date", label: "날짜", type: "date" }
    - { key: "exercise", label: "종목" }
  examples:
    - "이번 주 운동 보여줘"
```

### `name`
- 소문자 영문 + 숫자 + 밑줄만 (`^[a-zA-Z_][a-zA-Z0-9_]*$`)
- LLM이 호출할 식별자. 파일 전체에서 고유해야 함
- 동사로 시작하는 스네이크 케이스 권장 (`get_`, `list_`, `create_`, `update_`, `delete_`)

### `description`
- LLM이 툴을 고를 때 읽는 문장. 1~2문장, 조건과 반환하는 것을 명시
- 예: "주간 매출 데이터를 조회한다. 일자별·지역별 합계 포함."

### `endpoint`
- `"METHOD /path"` 포맷. METHOD는 `GET|POST|PUT|PATCH|DELETE`
- path 파라미터는 `:key` 표기: `GET /api/users/:id`
- `:key`가 있으면 반드시 `params.key`도 정의해야 함 (lint에서 잡힘)

### `params`
- 객체, 키는 파라미터 이름
- 각 항목 필수 필드: `description`
- 선택 필드: `type`(기본 string), `required`, `default`, `enum`

### `risk_level`
- `read` (기본값) — 즉시 실행
- `write` — 사용자 확인 필요, `confirm_message` 반드시 정의
- `critical` — 쓰기와 동일한 확인 요구. 되돌리기 불가능한 작업(삭제 등)에 사용

### `response_type`
- `text` (기본값) — 짧은 메시지 응답
- `table` — 반드시 `columns` 정의
- `raw` — API 응답을 구조 그대로 전달. 프론트에 이미 있는 그리드·차트 컴포넌트가 그 응답을 바로 렌더할 수 있을 때 선택
- `chart`·`auto`는 현재 런타임에서 미구현 → 사용하지 말 것

### `response_mapping` (선택, response_type=table일 때 유용)
- API 응답이 `{ data: { list: [...], total: N } }` 형태이면:
  ```yaml
  response_mapping:
    data_path: "data.list"
    total_path: "data.total"
  ```
- 응답이 곧 배열이면 생략 가능

### `request_body_template` (POST/PUT/PATCH 전용)
- 기본 body. `params`가 같은 키를 덮어씀
- 페이지네이션 기본값 등을 여기에 두면 LLM이 신경 쓸 필요 없음

### `confirm_message`
- `risk_level: write | critical`이면 반드시 정의
- 사용자에게 보여줄 확인 문구 (한국어 권장, 서비스 톤에 맞춤)

### `examples`
- 자연어 예시 2~5개. LLM에 description 뒤에 이어붙어 정확도 상승
- 사용자가 실제로 할 법한 문장으로

## 편집할 때 하지 말 것

- 스키마에 없는 커스텀 필드 추가 (lint가 거부). 새 필드가 필요하면 스키마 확장이 먼저
- 존재하지 않는 `response_type`·`risk_level` 값 사용
- `critical` 엔드포인트를 `confirm_message` 없이 방치
- 삭제 엔드포인트에 `risk_level: write` (대신 `critical` 사용)
- `endpoint`에서 ":" 없이 path 파라미터 표기 (`/users/{id}`는 허용되지 않음 — `/users/:id`)

## 사용자 피로 최소화 패턴

사용자가 매 질의에 모든 조건을 정밀히 적지 않아도 되도록 설계합니다. 다섯 축:

- **`params.default`**: 자주 쓰는 기본값을 지정. 생략 시 자동 적용됩니다.

  ```yaml
  params:
    period:
      description: "기간 (this_week, last_week, this_month)"
      type: string
      default: this_week
  ```

- **`examples` 풍부화 (5개 이상 권장)**: 같은 의도의 다양한 자연어 표현을 나열해 표현 흔들림을 흡수합니다.

  ```yaml
  examples:
    - "사용자 보여줘"
    - "유저 목록"
    - "활성 유저"
    - "멤버 리스트"
    - "가입자 조회"
  ```

- **`description`에 기본 동작 명시**: 조건이 없을 때 무엇이 일어나는지 한 문장 추가. LLM이 안전한 기본값을 고르게 됩니다.

  ```yaml
  description: "사용자 목록을 조회한다. 조건 미지정 시 최근 30일 내 활성 사용자."
  ```

- **조직 특수 용어·관습은 `domainDocs`로 주입**: `createAIEngine({ domainDocs: "..." })` — system prompt에 합쳐집니다. 예: "이 시스템에서 '환자'는 병동 재원 중인 환자를 의미한다".

- **LLM은 기본적으로 부족 정보를 되묻도록 지시되어 있음** (system prompt에 내장). 완전한 한 문장을 사용자에게 강요하지 말 것 — clarify 왕복 + history로 짧게 답해도 해석됩니다.

## 검증 플로우

편집 후 항상:

```bash
npx aiglue lint tools.yaml
```

lint 에러는 rule별로 분류됩니다:
- `schema` — JSON Schema 위반 (필수 필드·타입)
- `path-key-mismatch` — endpoint의 `:key`가 params에 없음
- `confirm-message-required` — write/critical인데 confirm_message 없음
- `table-columns-required` — table인데 columns 없음
- `duplicate-name` — 같은 name을 가진 도구가 둘 이상
