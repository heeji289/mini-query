# Step 3: 요청 중복 제거(dedup) & 레이스 컨디션 방지

> 💡 `step3/dedup-race` 브랜치를 `step2/react-binding`에서 파서 진행해주세요.

Step 1 끝에서 관찰했던 "같은 키인데 fetch가 여러 번 나가는 문제"를 이번에 해결해요.
그리고 비동기 세계의 단골 버그인 **레이스 컨디션**(늦게 온 응답이 최신 데이터를 덮어쓰는 현상)도 막아요.

---

## 📖 이해해야 할 내용

### 요청 중복 제거 (request deduplication)
- 같은 `queryKey`로 동시에 여러 컴포넌트가 마운트되면, 네트워크 요청은 **단 1번**만 나가야 해요.
- 원리: `Query`가 현재 진행 중인 **Promise를 들고 있다가(in-flight)**, fetch 요청이 또 들어오면 새 요청을 만들지 않고 그 Promise를 그대로 돌려줘요.
- fetch가 끝나면 in-flight Promise를 비워요(null). 그래야 다음 요청이 새로 나갈 수 있어요.

```
시각 t0: ObserverA.fetch() → in-flight 없음 → 진짜 요청 발사, query.promise = P
시각 t0: ObserverB.fetch() → in-flight P 있음 → P를 그대로 반환 (요청 안 나감)
시각 t1: P resolve → 둘 다 같은 결과 받음, query.promise = null
```

### 레이스 컨디션 (race condition)
- 시나리오: 검색어 "a" 요청을 보냈는데 느림 → 사용자가 "ab"로 바꿔 새 요청 → "ab"가 먼저 도착 → 그 다음 느린 "a" 응답이 도착해서 화면을 "a" 결과로 덮어씀. 😱
- 방어법: 각 fetch에 **순번(혹은 토큰/세대)**을 매기고, 응답을 반영하기 전에 "내가 가장 최신 요청이 맞는가?"를 확인해요. 최신이 아니면 결과를 버려요.
- 또는: 새 fetch가 시작되면 이전 in-flight를 **취소(AbortController)** 하는 방법도 있어요. (둘을 조합하면 가장 견고해요.)

### 왜 단순 `await`만으론 부족한가
- `const data = await queryFn(); this.state.data = data;` 는 "이 await가 끝났을 때 이게 여전히 최신인가?"를 보장하지 않아요.
- 비동기 함수 안에서 `this.state`를 건드릴 땐 항상 "await 전후로 세상이 바뀌었을 수 있다"를 의심하세요.

---

## 🔧 구현 내용

### 1단계: in-flight Promise로 dedup

`Query.fetch()`를 이렇게 바꿔요:

```ts
class Query<T> {
  private promise: Promise<T> | null = null;
  // ...

  fetch(): Promise<T> {
    // 1) 이미 진행 중인 promise가 있으면 그걸 반환 (요청 안 나감)
    if (this.promise) return this.promise;

    // 2) isFetching = true 로 setState
    // 3) this.promise = (async () => { ... queryFn 실행, 성공/실패 처리 ... })()
    // 4) finally에서 this.promise = null
    // 5) this.promise 반환
  }
}
```

검증: 같은 키를 쓰는 `<Posts />`를 2개 띄우고 Network 탭에서 요청이 **1번**만 나가는지 확인하세요.

### 2단계: 세대(generation) 카운터로 레이스 방어

```ts
class Query<T> {
  private fetchId = 0;

  fetch(): Promise<T> {
    const currentId = ++this.fetchId; // 이번 요청의 순번

    this.promise = (async () => {
      try {
        const data = await this.queryFn();
        // ★ 응답 반영 전 체크: 내가 아직 최신 요청인가?
        if (currentId !== this.fetchId) return /* 버림 */;
        // setState로 성공 반영
      } catch (e) {
        if (currentId !== this.fetchId) return;
        // setState로 에러 반영
      }
    })();
    return this.promise;
  }
}
```

> dedup(1단계)과 race 방어(2단계)는 미묘하게 충돌할 수 있어요. "진행 중이면 재사용"과 "새 요청이 오면 이전 걸 무효화"는 언제 어느 쪽을 택해야 할까요? 힌트: **자동 마운트로 인한 중복**은 dedup 대상이고, **명시적 refetch/키 변경**은 새 세대로 봐야 할 때가 많아요. 본인 규칙을 정하고 근거를 적어두세요.

### 3단계 (선택): AbortController로 실제 취소

```ts
// queryFn에 signal을 넘겨서, 새 fetch 시작 시 이전 요청을 abort
queryFn: ({ signal }) => fetch(url, { signal }).then((r) => r.json())
```

- `queryFn`의 시그니처를 `(context: { signal: AbortSignal }) => Promise<T>` 로 확장해보세요.
- 취소된 fetch의 에러(`AbortError`)는 사용자에게 에러로 노출하지 않도록 걸러야 해요.

---

## ✅ 완료 기준 (Definition of Done)

- [ ] 같은 키를 쓰는 컴포넌트가 동시에 N개 마운트돼도 네트워크 요청은 1번만 나간다
- [ ] in-flight Promise가 끝나면 비워져서, 이후 새 요청이 정상적으로 나간다
- [ ] 느린 이전 응답이 빠른 최신 응답을 덮어쓰지 않는다 (세대 카운터로 방어)
- [ ] (선택) `AbortController`로 이전 요청을 취소하고, `AbortError`는 에러로 노출하지 않는다
- [ ] 위 내용을 인위적 지연(`setTimeout`)으로 재현하는 테스트/데모를 만들었다

### 레이스 컨디션 재현 데모 힌트
```ts
// queryFn에 인위적 지연을 주입해서 순서를 뒤집어보세요
let delay = 1000;
queryFn: async () => {
  await new Promise((r) => setTimeout(r, delay));
  delay = 100; // 다음 요청은 빠르게 → 순서 역전 유도
  return fetch(...)...;
}
```

---

## 🧠 생각해볼 거리

- dedup을 Query(Subject)가 하는 게 맞나요, 아니면 더 상위(QueryClient)에서 해야 하나요? 왜 Query 레벨이 자연스러울까요?
- 만약 두 컴포넌트의 `queryFn`이 미묘하게 다르면(같은 키, 다른 함수) 어느 함수로 fetch해야 할까요? (TanStack은 "마지막에 등록된 옵션"을 쓰는 경향이 있어요. 이게 버그의 원천이 될 수도 있는데, 왜일까요?)
- 세대 카운터 방식과 AbortController 방식의 장단점을 비교해보세요. 네트워크 비용 관점에서는 어느 쪽이 유리한가요?
