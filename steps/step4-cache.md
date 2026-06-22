# Step 4: 캐싱 — staleTime & gcTime (가비지 컬렉션)

> 💡 `step4/caching` 브랜치를 `step3/dedup-race`에서 파서 진행해주세요.

이번 Step이 이 라이브러리의 **알맹이**예요. 지금까지는 매번 fetch했지만, 이제 캐시를 도입해서
"신선하면 안 가져오고, 오래됐으면 백그라운드로 갱신하고, 아무도 안 쓰면 메모리에서 치우는" 정책을 구현해요.

> "캐시 무효화는 컴퓨터 과학에서 어려운 문제 중 하나"라는 말을 몸으로 느끼는 Step이에요.

---

## 📖 이해해야 할 내용

### staleTime vs gcTime — 헷갈리지 마세요
이 둘은 완전히 다른 축을 제어해요.

| 구분 | staleTime | gcTime (구 cacheTime) |
| --- | --- | --- |
| 의미 | 데이터가 "신선하다"고 간주되는 기간 | 구독자가 0이 된 캐시를 메모리에 유지하는 기간 |
| 기준 시점 | `dataUpdatedAt`(마지막 성공) 이후 | 마지막 Observer가 unsubscribe된 이후 |
| 만료되면 | 다음 트리거 때 **백그라운드 refetch** | 캐시(Query)를 **메모리에서 제거** |
| 기본값(TanStack) | `0` (항상 stale) | `5분` |

핵심 한 줄: **staleTime은 "언제 다시 가져올까", gcTime은 "언제 버릴까"** 예요.

### stale일 때의 동작 — stale-while-revalidate
- 마운트 시 캐시가 **fresh**(`now - dataUpdatedAt < staleTime`)면 → 네트워크 요청 없이 캐시 즉시 반환.
- 캐시가 **stale**이면 → **캐시를 먼저 보여주고(data 유지)**, 동시에 백그라운드에서 refetch. 갱신되면 화면을 새 데이터로 교체.
- 이때 사용자는 빈 화면/스피너를 안 봐요. `isFetching: true`이지만 `data`는 이미 있는 상태죠. (이게 `status === "pending"` 과 `isFetching` 을 분리하는 이유!)

### 가비지 컬렉션 — 참조 카운팅
- Query는 자기를 구독하는 Observer 수를 알아요. 마지막 Observer가 `unsubscribe`하면 구독자가 0이 돼요.
- 구독자가 0이 되는 순간 바로 지우면 안 돼요. 사용자가 페이지를 잠깐 떠났다 돌아올 수 있으니까요.
- 그래서 **`gcTime`만큼 타이머를 걸고**, 그 안에 새 구독자가 생기면 타이머를 취소해요. 타이머가 끝나면 QueryCache에서 그 Query를 제거해요.
- 이건 사실상 수동 참조 카운팅 기반 GC예요. (브라우저의 GC와는 별개로, "논리적 캐시 수명"을 우리가 관리하는 거예요.)

```
Observer 2개 구독 중 ─┐
                      ├─ 둘 다 unsubscribe → 구독자 0 → gcTime(60s) 타이머 시작
                      │      ├─ 30초 후 새 구독자 등장 → 타이머 취소, 캐시 유지 ✅
                      │      └─ 아무도 안 옴 → 60초 후 cache.remove(query) 🗑️
```

---

## 🔧 구현 내용

### 1단계: 옵션 전파 (staleTime, gcTime)
- `QueryClient`의 `defaultOptions`와 `useQuery`의 개별 옵션을 병합해서 Observer/Query가 알 수 있게 하세요.
- 우선순위: 개별 `useQuery` 옵션 > `defaultOptions`.

### 2단계: stale 판정 & 조건부 fetch

Observer가 구독을 시작할 때(또는 마운트 시) 무조건 fetch하지 말고, 판단하게 하세요.

```ts
class Query<T> {
  isStale(staleTime: number): boolean {
    // data가 없으면 항상 stale
    // now - this.state.dataUpdatedAt >= staleTime 이면 stale
  }
}

class QueryObserver<T> {
  subscribe(listener: () => void) {
    const unsub = this.query.subscribe(listener);
    // fresh면 fetch 안 함, stale이면 백그라운드 fetch
    if (this.query.isStale(this.options.staleTime)) {
      this.query.fetch();
    }
    return () => { /* unsub + GC 스케줄 */ };
  }
}
```

> 포인트: stale이어도 `data`는 유지한 채 `isFetching`만 true가 돼야 해요. `fetch()`가 data를 비우지 않도록 주의하세요.

### 3단계: 가비지 컬렉션 타이머

```ts
class Query<T> {
  private gcTimeout: ReturnType<typeof setTimeout> | null = null;

  subscribe(listener: () => void): () => void {
    this.observers.add(listener);
    this.clearGcTimeout(); // 구독자가 생겼으니 GC 취소
    return () => {
      this.observers.delete(listener);
      if (this.observers.size === 0) this.scheduleGc();
    };
  }

  private scheduleGc() {
    // gcTime 후 cache.remove(this) 호출
  }
  private clearGcTimeout() {
    // 타이머 취소
  }
}
```

- `QueryCache`에 `remove(query)`를 추가해서, Query가 자기 자신을 캐시에서 빼낼 수 있게 하세요. (Query가 cache 참조를 알아야 하니, build 시 주입해주세요.)

### 4단계: 검증 시나리오
1. **fresh 캐시 재사용**: `staleTime: 5000`으로 두고, `<Posts />`를 unmount→즉시 remount. Network 요청이 **안 나가야** 함.
2. **stale 백그라운드 갱신**: `staleTime: 0`으로 두고 remount. 캐시가 즉시 보이면서(빈 화면 없음) Network 요청이 나가고, 끝나면 갱신됨.
3. **GC**: `gcTime: 3000`으로 두고 모든 `<Posts />`를 unmount. 3초 후 `cache.getAll()`에서 해당 Query가 사라지는지 확인. 3초 안에 remount하면 유지되는지 확인.

---

## ✅ 완료 기준 (Definition of Done)

- [ ] `staleTime` 안에서 remount하면 네트워크 요청이 나가지 않고 캐시가 즉시 표시된다
- [ ] stale 상태에서 remount하면 캐시를 먼저 보여주고 백그라운드에서 갱신한다 (빈 화면/스피너 없음)
- [ ] 백그라운드 갱신 중 `status`는 `success`, `isFetching`은 `true`다 (둘이 분리됨)
- [ ] 마지막 구독자가 사라지고 `gcTime`이 지나면 Query가 캐시에서 제거된다
- [ ] `gcTime` 안에 새 구독자가 생기면 GC 타이머가 취소되고 캐시가 유지된다
- [ ] 옵션 병합 우선순위(개별 > default)가 동작한다

---

## 🧠 생각해볼 거리

- `staleTime: Infinity`로 두면 어떤 동작이 될까요? 어떤 데이터에 적합할까요? (거의 안 변하는 설정값 등)
- `gcTime`이 `staleTime`보다 작으면 어떤 이상한 일이 벌어질 수 있을까요?
- 백그라운드 refetch가 **실패**하면 화면은 어떻게 돼야 할까요? 기존 캐시 data를 유지할까요, 에러로 바꿀까요? (TanStack은 기존 data를 유지하고 `error`만 채워요. 왜 그게 더 나은 UX일까요?)
- 탭을 100개 열어서 각각 다른 키를 구독하면 메모리가 무한정 늘까요? GC가 이걸 어떻게 막아주나요?
