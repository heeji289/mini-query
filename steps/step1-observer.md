# Step 1: 옵저버 골격 만들기 — React 없이 동작하는 코어

> 💡 `step1/observer-core` 브랜치를 파서 진행해주세요. 이 브랜치의 최종 상태가 Step 2의 출발점이 돼요.

이번 Step의 목표는 **React를 전혀 쓰지 않고** 라이브러리의 심장(코어)을 먼저 만드는 거예요.
`queryFn`을 실행해서 결과를 저장하고, 구독자(subscriber)에게 변경을 알리는 데까지를 순수 TypeScript로 구현합니다.

왜 React 없이 먼저 만드냐고요? 캐시/상태/구독 로직은 React와 무관한 순수 로직이에요. 코어를 framework-agnostic하게 분리해두면 테스트도 쉽고, 다음 Step에서 React는 "이 코어를 구독하는 얇은 어댑터"로만 붙이면 되거든요. (실제로 TanStack Query도 `@tanstack/query-core`와 `@tanstack/react-query`가 분리돼 있어요.)

---

## 📖 이해해야 할 내용

### 옵저버 패턴 (Subject ↔ Observer)
- **Subject**: 상태를 가지고 있고, 상태가 바뀌면 자기를 구독하는 대상들에게 알려주는 쪽. 여기선 `Query`예요.
- **Observer**: Subject를 구독하고, 알림을 받으면 반응하는 쪽. 여기선 `QueryObserver`예요.
- 핵심 메서드 3개: `subscribe(listener)`, `unsubscribe(listener)`, `notify()`.
- `subscribe`는 보통 **구독 해제 함수(cleanup)를 반환**해요. 왜 그렇게 설계하는 게 편할까요? (React `useEffect`의 cleanup과 연결해서 생각해보세요.)

### 각 객체의 책임 (역할 분리)
| 객체 | 책임 | 들고 있는 것 |
| --- | --- | --- |
| `QueryClient` | 진입점. 전역 옵션 관리, cache 소유 | `QueryCache` |
| `QueryCache` | queryKey별 `Query` 인스턴스 저장소 | `Map<string, Query>` |
| `Query` | 한 queryKey의 상태/데이터 보유 (Subject) | `state`, `observers[]`, `queryFn` |
| `QueryObserver` | `useQuery` 한 번에 대응. Query 구독 (Observer) | 구독 중인 `Query`, 외부 listener |

> 한 객체가 두 가지 책임을 가지면 나중에 Step이 쌓일수록 터져요. "이 로직은 누구의 책임인가?"를 계속 자문하면서 경계를 그어주세요.

### queryKey는 왜 직렬화하나요?
- 사용자는 `queryKey: ["posts", 1]` 처럼 **배열**로 키를 줘요.
- 그런데 `["posts", 1] === ["posts", 1]`은 `false`예요 (참조가 다름). 이걸 그대로 Map 키로 쓰면 같은 키인데 매번 다른 Query가 생겨요.
- 그래서 배열을 **결정적(deterministic) 문자열**로 바꿔서 Map 키로 써요. 보통 `JSON.stringify`를 쓰되, 객체 속성 순서가 달라도 같은 키가 되도록 정렬해줘야 해요.
  - 예: `{ a: 1, b: 2 }` 와 `{ b: 2, a: 1 }` 는 같은 키여야 할까요? (TanStack Query는 같은 키로 봐요.)

### 상태(state)는 불변(immutable)하게 갱신해요
- `query.state.data = ...` 처럼 직접 수정(mutate)하지 마세요.
- `query.state = { ...query.state, data, status }` 처럼 **새 객체로 교체**한 뒤 notify하세요.
- 이유는 Step 2에서 드러나요: `useSyncExternalStore`는 snapshot의 참조가 바뀌어야 리렌더를 트리거하거든요. (지금 미리 습관을 들여두면 좋아요.)

---

## 🔧 구현 내용

아래는 뼈대 가이드예요. 시그니처와 흐름만 제시하니 **내부는 직접 완성**하세요. 타입은 본인이 더 엄격하게 잡아도 좋아요.

### 1단계: queryKey 해싱

```ts
// lib/utils.ts
export type QueryKey = readonly unknown[];

// 배열 queryKey를 결정적 문자열로 변환
// 힌트: JSON.stringify의 replacer로 객체 키를 정렬하면 순서 무관해져요
export function hashKey(queryKey: QueryKey): string {
  // TODO
}
```

직접 답해보기:
- 함수(`queryFn`)나 `undefined`가 키에 섞이면 어떻게 처리할까요? (보통 queryKey에는 직렬화 가능한 값만 넣도록 규약을 둬요.)

### 2단계: Query (Subject)

```ts
// lib/Query.ts
type QueryStatus = "pending" | "error" | "success";

interface QueryState<T> {
  status: QueryStatus;
  data: T | undefined;
  error: unknown;
  isFetching: boolean;
  dataUpdatedAt: number;
}

export class Query<T = unknown> {
  queryKey: QueryKey;
  queryHash: string;
  state: QueryState<T>;
  private observers: Array<() => void> = []; // listener(콜백) 목록
  private queryFn: () => Promise<T>;

  constructor(config: { queryKey: QueryKey; queryHash: string; queryFn: () => Promise<T> }) {
    // 초기 state는 status: "pending", isFetching: false 로 시작
  }

  subscribe(listener: () => void): () => void {
    // observers에 추가하고, 제거하는 cleanup 함수를 반환
  }

  private setState(updater: (prev: QueryState<T>) => QueryState<T>): void {
    // 1) 새 state로 교체 (불변!)
    // 2) notify()
  }

  private notify(): void {
    // 모든 listener 호출
  }

  async fetch(): Promise<T> {
    // 1) isFetching = true 로 setState
    // 2) queryFn() 실행
    // 3) 성공: status="success", data, dataUpdatedAt 갱신, isFetching=false
    // 4) 실패: status="error", error, isFetching=false
    // (dedup/레이스 컨디션은 Step 3에서 다루니 지금은 단순하게)
  }
}
```

### 3단계: QueryCache (저장소)

```ts
// lib/QueryCache.ts
export class QueryCache {
  private queries = new Map<string, Query>();

  // queryHash로 기존 Query를 찾고, 없으면 만들어서 등록한 뒤 반환
  build<T>(client: QueryClient, options: { queryKey: QueryKey; queryFn: () => Promise<T> }): Query<T> {
    // TODO: get-or-create 패턴
  }

  get(queryHash: string): Query | undefined {
    // TODO
  }

  getAll(): Query[] {
    // TODO (디버깅/검증용)
  }
}
```

### 4단계: QueryClient (진입점)

```ts
// lib/QueryClient.ts
export class QueryClient {
  private queryCache: QueryCache;

  constructor(config?: { defaultOptions?: { queries?: { staleTime?: number; gcTime?: number } } }) {
    // queryCache 생성, defaultOptions 저장 (옵션은 Step 4에서 본격 사용)
  }

  getQueryCache(): QueryCache {
    // TODO
  }

  // 캐시에 있으면 그 데이터를, 없으면 undefined
  getQueryData<T>(queryKey: QueryKey): T | undefined {
    // TODO
  }
}
```

### 5단계: QueryObserver (Observer)

```ts
// lib/QueryObserver.ts
export class QueryObserver<T = unknown> {
  private client: QueryClient;
  private options: { queryKey: QueryKey; queryFn: () => Promise<T> };
  private query!: Query<T>;

  constructor(client: QueryClient, options: QueryObserver<T>["options"]) {
    // options 저장, cache.build로 query 확보
  }

  // 외부(다음 Step의 React)가 구독하는 진입점.
  // query를 구독하고, 필요하면 첫 fetch를 트리거한 뒤, cleanup을 반환
  subscribe(listener: () => void): () => void {
    // 1) this.query.subscribe(listener)
    // 2) 아직 한 번도 안 가져왔으면 query.fetch() 트리거
    // 3) cleanup 반환
  }

  // 현재 결과 스냅샷 (data/status/isFetching ...)
  getResult(): QueryState<T> {
    // TODO: this.query.state 기반으로 반환 (지금은 그대로 패스해도 OK)
  }
}
```

### 6단계: React 없이 검증하기

`src/app/`에 데모를 두지 말고, 작은 스크립트나 테스트로 코어만 검증해보세요.

```ts
// playground.ts (tsx 또는 vitest로 실행)
const client = new QueryClient();

const observer = new QueryObserver(client, {
  queryKey: ["posts"],
  queryFn: async () => {
    console.log("🌐 실제 fetch 실행!");
    await new Promise((r) => setTimeout(r, 300));
    return [{ id: 1, title: "hello" }];
  },
});

const unsubscribe = observer.subscribe(() => {
  console.log("🔔 알림:", observer.getResult());
});

// 기대 동작:
// 🌐 실제 fetch 실행!   ← fetch 시작
// 🔔 알림: { isFetching: true, status: "pending", ... }
// 🔔 알림: { status: "success", data: [...], isFetching: false }
```

검증 포인트 (이번 Step의 진짜 목표):
- **같은 키로 Observer를 2개 만들면, `queryFn`(🌐 로그)이 몇 번 찍히나요?**
  - 지금 단순 구현이라면 2번 찍힐 수 있어요. "왜 2번 나갈까? 1번만 나가게 하려면 무엇이 필요할까?"를 메모해두세요 → 이게 **Step 3(dedup)**의 출발점이에요.
- 같은 키를 쓰는 두 Observer가 **같은 `Query` 인스턴스**를 공유하나요? (`cache.getAll().length`로 확인)
- `unsubscribe()` 후에는 알림이 더 이상 안 오나요?

---

## ✅ 완료 기준 (Definition of Done)

- [ ] `QueryClient` / `QueryCache` / `Query` / `QueryObserver` 4개 객체의 책임이 분리되어 있다
- [ ] `hashKey`가 객체 속성 순서와 무관하게 같은 키를 같은 문자열로 변환한다
- [ ] 같은 `queryKey`로 만든 두 Observer가 **같은 `Query` 인스턴스**를 공유한다 (`getAll().length === 1`)
- [ ] `observer.subscribe(listener)` 후 fetch가 진행되며, 상태 변화마다 `listener`가 호출된다
- [ ] `state`를 직접 mutate하지 않고 항상 새 객체로 교체한 뒤 notify한다
- [ ] `unsubscribe()` 호출 후에는 listener가 더 이상 호출되지 않는다
- [ ] React를 import하지 않고도(순수 TS 스크립트/테스트로) 위 동작을 검증했다
- [ ] "같은 키인데 fetch가 2번 나가는 문제"를 관찰하고, 왜 그런지 한 줄로 메모를 남겼다 (Step 3 예고)

---

## 🧠 생각해볼 거리 (정답 없음)

- `Query`가 listener를 배열(`Array`)로 들고 있는데, `Set`을 쓰면 뭐가 더 좋을까요? 같은 listener가 중복 등록되면?
- `Query`가 자기 `queryFn`을 들고 있는 게 맞을까요, 아니면 Observer가 들고 있다가 넘겨주는 게 맞을까요? (둘 다 일리가 있어요. TanStack은 Observer의 옵션이 Query로 전달되는 구조예요. 본인 선택의 근거를 적어두세요.)
- 이 코어를 나중에 Vue나 Svelte에 붙인다고 상상하면, 지금 React 의존성을 코어에 넣지 않는 게 왜 중요한지 보일 거예요.
