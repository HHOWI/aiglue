---
description: aiglue tools.yaml authoring guide — apply when editing tools.yaml
globs:
  - tools.yaml
  - "**/tools.yaml"
alwaysApply: false
---

# aiglue tools.yaml 작성 지침

이 규칙은 `tools.yaml`을 편집할 때 자동 적용됩니다. `@aiglue/core` 런타임이 이 파일을 읽어 LLM tool 정의·safety whitelist·executor 라우팅을 모두 구성합니다.

## 스키마 원본
`node_modules/@aiglue/core/schema/tools.schema.json` — 모호하면 이 파일을 참조.

## 필수 규칙

- `name`: `^[a-zA-Z_][a-zA-Z0-9_]*$` 패턴, 파일 내 고유
- `description`: LLM이 읽는 한두 문장
- `endpoint`: `"GET|POST|PUT|PATCH|DELETE /path"` 포맷. path 파라미터는 `:key`
- `endpoint`에 `:key`가 있으면 `params.key` 반드시 정의
- `risk_level: write | critical`이면 `confirm_message` 반드시 정의
- `response_type: table`이면 `columns` 반드시 정의
- `response_type`·`risk_level`의 값은 스키마 enum 밖 사용 금지

## 편집 후 검증

```bash
npx aiglue lint tools.yaml
```

lint 에러 룰 카탈로그: `schema` · `path-key-mismatch` · `confirm-message-required` · `table-columns-required` · `duplicate-name`.

## 사용자 피로 최소화

- `params.default`로 자주 쓰는 값을 기본값으로 지정
- `examples`에 같은 의도의 표현을 5개 이상 나열
- `description`에 "조건 미지정 시 기본 동작" 명시
- 조직 특수 용어는 `domainDocs`로 system prompt에 주입

## 템플릿

```yaml
- name: <verb>_<noun>
  description: "..."
  endpoint: GET /api/...
  params:
    <key>:
      description: "..."
      type: string
      required: false
  response_type: text
  risk_level: read
  examples:
    - "..."
```

write/critical일 때만 `confirm_message` 추가. table일 때만 `columns` 추가.
