# Step 5: refetch 전략 & 무효화 & 재시도

> 💡 `step5/refetch-invalidate` 브랜치를 `step4/caching`에서 파서 진행해주세요.

캐시가 생겼으니, 이제 "언제 다시 가져올지"를 제어하는 트리거들을 붙여요.
명시적 `refetch`, `invalidateQueries`(무효화), 윈도우 포커스 시 자동 갱신, 실패 시 `retry` + 지수 백오프까지 다뤄요.

---

## 📖 이해해야 할 내용

### refetch vs invalidate
- **refetch**: 특정 Query를 "지금 당장 다시 가져와". staleTime 무시하고 강제로 fetch.
- **invalidateQueries**: 해당 Query(들)을 "stale로 표시"하고, **활성 구독자가 있으면** refetch. 구독자가 없으면 다음에 마운트될 때 stale이라 알아서 갱신돼요.
- 차이의 핵심: invalidate는 "더럽다고 마킹"이고, refetch는 "당장 실행"이에요. 뮤테이션(POST) 후엔 보통 invalidate를 써요.

### 부분 일치(partial matching)
- `invalidateQueries({ queryKey: ["posts"] })`는 `["posts"]` 뿐 아니라 `["posts", 1]`, `["posts", { page: 2 }]` 까지 **prefix가 일치하는 모든 Query**를 무효화해요.
- 그래서 무효화는 "정확히 같은 키"가 아니라 "이 키로 시작하는 키들"을 찾는 부분 일치 로직이 필요해요.

### refetchOnWindowFocus
- 사용자가 다른 탭 갔다가 돌아오면, 데이터가 그 사이 바뀌었을 수 있으니 자동으로 갱신해주는 기능이에요.
- `window`의 `focus`(또는 `visibilitychange`) 이벤트를 듣고, stale한 활성 Query들을 refetch해요.
- 전역 이벤트 리스너는 **한 번만** 등록하고 정리(cleanup)도 해야 해요. 어디서 관리하는 게 좋을까요? (QueryCache? 별도 FocusManager?)

### retry & 지수 백오프 (exponential backoff)
- fetch가 실패하면 바로 에러로 끝내지 말고 N번 재시도해요 (기본 3번).
- 재시도 간격은 점점 늘려요: `1000 * 2 ** attemptIndex` (1초 → 2초 → 4초 …), 보통 상한(예: 30초)을 둬요.
- 모든 재시도가 실패하면 그제서야 `status: "error"`로 확정해요. 재시도 중엔 `isFetching`이 유지돼요.

---

## 🔧 구현 내용

### 1단계: refetch

```ts
class QueryObserver<T> {
  refetch(): Promise<T> {
    // staleTime 무시하고 강제로 query.fetch({ force: true }) 같은 형태
  }
}
// useQuery 반환값에 refetch를 포함시키기
```

> Step 3에서 만든 dedup과 충돌하지 않게 하세요. 강제 refetch는 in-flight가 있더라도 새 세대로 가야 할 수도 있어요. (본인 규칙 정하기)

### 2단계: invalidateQueries (부분 일치)

```ts
class QueryClient {
  invalidateQueries(filters: { queryKey: QueryKey }): Promise<void> {
    // 1) cache.getAll() 중 filters.queryKey와 prefix가 일치하는 Query 찾기
    // 2) 각 Query를 stale로 표시 (예: dataUpdatedAt = 0 또는 isInvalidated 플래그)
    // 3) 활성 구독자가 있는 Query는 refetch
  }
}

// 부분 일치 헬퍼
function partialMatchKey(target: QueryKey, prefix: QueryKey): boolean {
  // prefix의 각 요소가 target의 앞부분과 깊은 비교로 일치하는지
}
```

### 3단계: refetchOnWindowFocus

```ts
// lib/focusManager.ts (또는 QueryCache 내부)
function setupFocusListener(onFocus: () => void) {
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") onFocus();
  });
  // cleanup 반환
}
// onFocus에서: 활성 + stale인 Query들을 refetch
```

- 옵션 `refetchOnWindowFocus: boolean`으로 끌 수 있게 하세요.

### 4단계: retry + 지수 백오프

`Query.fetch`의 비동기 로직을 재시도 루프로 감싸요.

```ts
async function fetchWithRetry<T>(fn: () => Promise<T>, retry: number, retryDelay: (i: number) => number): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= retry) throw e;       // 다 썼으면 진짜 에러
      await sleep(retryDelay(attempt));     // 점점 길게 대기
      attempt++;
    }
  }
}
// 기본값: retry = 3, retryDelay = (i) => Math.min(1000 * 2 ** i, 30000)
```

- 재시도 중에도 `isFetching: true`가 유지되고, 최종 실패 시에만 `status: "error"`.
- (선택) `AbortError`나 4xx 같은 건 재시도하지 않도록 거르는 규칙을 둘 수도 있어요.

### 5단계: 검증
- `invalidateQueries({ queryKey: ["posts"] })` 호출 시 `["posts"]`와 `["posts", 1]`이 모두 갱신되는지.
- 탭을 전환했다 돌아오면 stale Query가 refetch되는지 (Network 탭).
- `queryFn`이 2번 실패하고 3번째 성공하도록 만들어서, 1s→2s 간격으로 재시도 후 성공하는지.

---

## ✅ 완료 기준 (Definition of Done)

- [ ] `useQuery`가 반환하는 `refetch()`가 staleTime과 무관하게 강제 갱신한다
- [ ] `invalidateQueries`가 prefix 부분 일치로 여러 Query를 무효화한다
- [ ] 무효화된 Query 중 활성 구독자가 있는 것은 즉시 refetch, 없는 것은 다음 마운트 때 갱신된다
- [ ] 탭 복귀(`visibilitychange`) 시 stale 활성 Query가 자동 refetch된다 (옵션으로 끌 수 있음)
- [ ] 실패 시 지수 백오프로 N번 재시도하고, 다 실패해야 `status: "error"`가 된다
- [ ] 재시도 중에는 `isFetching: true`가 유지된다
- [ ] 전역 focus 리스너가 중복 등록되지 않고 정리된다

---

## 🧠 생각해볼 거리

- invalidate를 "당장 refetch"가 아니라 "stale 마킹"으로 설계하면 어떤 이점이 있나요? (백그라운드 탭, 비활성 Query 관점)
- 부분 일치에서 `["posts", 1]`로 무효화하면 `["posts"]`도 무효화돼야 할까요? (방향이 반대죠. 왜 prefix 방향만 매치하는 게 자연스러운지 생각해보세요.)
- 지수 백오프에 "지터(jitter, 무작위 흔들기)"를 더하는 이유는 뭘까요? (서버가 한꺼번에 재시도 폭탄 맞는 상황을 떠올려보세요.)
- `refetchOnReconnect`(네트워크 재연결 시 갱신)도 같은 패턴으로 추가할 수 있어요. 어디에 끼워넣으면 될까요?
