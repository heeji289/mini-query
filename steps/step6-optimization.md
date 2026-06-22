# Step 6: 참조 안정성(structural sharing) & 리렌더 최적화

> 💡 `step6/optimization` 브랜치를 `step5/refetch-invalidate`에서 파서 진행해주세요.

기능은 다 됐어요. 이번엔 **불필요한 리렌더를 없애는** 최적화 Step이에요.
"내용이 같으면 같은 참조를 유지한다(structural sharing)"와 "필요한 부분만 구독한다(select)"를 구현하고,
React Profiler로 실제로 리렌더가 줄었는지 **측정**해요.

---

## 📖 이해해야 할 내용

### 왜 리렌더가 과하게 일어나나
- background refetch가 끝날 때마다 `queryFn`은 새 객체/배열을 반환해요 (`fetch().json()`은 매번 새 참조).
- 데이터 **내용**은 그대로인데 **참조**가 바뀌면, 그 data를 props로 받는 자식들이 전부 리렌더돼요.
- 또, `useQuery` 결과 객체(`{ data, status, ... }`)가 매번 새로 만들어지면, 그걸 의존성으로 쓰는 `useMemo`/`useEffect`도 매번 재실행돼요.

### structural sharing (구조적 공유)
- 이전 데이터와 새 데이터를 깊게 비교해서, **바뀌지 않은 부분은 이전 참조를 그대로 재사용**하는 기법이에요.
- 예: `posts` 배열에서 3번 글만 바뀌었으면, 나머지 글 객체들과 배열 자체의 안 바뀐 부분은 이전 참조 유지. 결과적으로 바뀐 항목만 새 참조.
- 효과: `data`를 받는 컴포넌트들 중 실제로 바뀐 데이터를 쓰는 것만 리렌더돼요. `React.memo`와 만나면 강력해져요.

```
이전: [A, B, C]   새 응답: [A, B', C]  (B만 변경)
structural sharing 적용 후: [A(이전참조), B'(새참조), C(이전참조)]
→ A, C를 쓰는 컴포넌트는 리렌더 안 됨
```

### select — 부분 구독
- `useQuery({ ..., select: (data) => data.length })` 처럼, 컴포넌트가 **데이터의 일부/가공값**만 구독하게 해요.
- `select` 결과가 이전과 같으면(같은 참조 또는 같은 원시값) 리렌더하지 않아요.
- 효과: 거대한 응답에서 `data.length`만 쓰는 컴포넌트는, 목록 내용이 바뀌어도 length가 그대로면 리렌더 안 됨.

### getSnapshot 안정성 (Step 2 복습)
- Observer의 `getResult()`가 state가 안 바뀌었을 땐 **반드시 동일 참조**를 반환해야 해요.
- 결과 객체를 캐싱해뒀다가, 내부 state나 select 결과가 실제로 바뀐 경우에만 새로 만들어요.

---

## 🔧 구현 내용

### 1단계: structural sharing 구현

```ts
// lib/utils.ts
// 이전 값과 새 값을 비교해서, 깊게 동일하면 이전 참조를 재사용해 병합한 값을 반환
export function replaceEqualDeep<T>(prev: unknown, next: T): T {
  // 1) prev와 next가 깊게 같으면 prev를 반환 (참조 유지)
  // 2) 배열/객체면 각 요소에 재귀 적용, 바뀐 것만 새로
  // 3) 원시값이면 그냥 next
}
```

- `Query.fetch` 성공 시 `data`를 그대로 넣지 말고, `replaceEqualDeep(prevData, newData)`의 결과를 넣으세요.
- 옵션 `structuralSharing: boolean`(기본 true)으로 끌 수 있게 해도 좋아요.

### 2단계: select + 결과 캐싱

```ts
class QueryObserver<T, S = T> {
  private lastResult!: QueryResult<S>;

  getResult(): QueryResult<S> {
    const state = this.query.state;
    const selected = this.options.select ? this.options.select(state.data) : state.data;

    // selected가 이전과 동일하고 다른 필드도 그대로면 lastResult를 그대로 반환 (참조 유지)
    // 바뀐 경우에만 새 객체 만들어서 lastResult에 저장
    return this.lastResult;
  }
}
```

> 여기가 이번 Step의 핵심이에요. "언제 새 객체를 만들고, 언제 이전 걸 재사용할지" 판정 로직을 신중하게 짜세요. 잘못하면 (a) 무한 렌더링(항상 새 참조) 또는 (b) 화면이 안 바뀜(항상 이전 참조) 둘 중 하나가 나요.

### 3단계: 측정 — React Profiler

최적화는 **숫자로 증명**해야 의미가 있어요.

1. `<React.Profiler>` 또는 React DevTools의 Profiler 탭으로 리렌더 횟수를 기록하세요.
2. 시나리오:
   - 같은 데이터로 background refetch가 일어났을 때, `data`를 쓰는 자식이 리렌더되나요? (structural sharing OFF vs ON 비교)
   - `select: (d) => d.length`를 쓰는 컴포넌트가, 목록 내용만 바뀌고 length는 그대로일 때 리렌더되나요?
3. **Before/After 리렌더 횟수를 표로 정리**해서 README에 남기세요. (이게 이 Step의 결과물이에요.)

---

## ✅ 완료 기준 (Definition of Done)

- [ ] `replaceEqualDeep`가 내용이 같은 부분의 참조를 유지한다 (단위 테스트로 증명)
- [ ] 내용이 동일한 background refetch 후, data를 받는 `React.memo` 자식이 리렌더되지 않는다
- [ ] `select`로 가공한 값이 이전과 같으면 컴포넌트가 리렌더되지 않는다
- [ ] `getResult()`가 state 미변경 시 동일 참조를 반환한다 (무한 렌더링 없음)
- [ ] structural sharing ON/OFF의 리렌더 횟수 차이를 Profiler로 측정해 표로 남겼다

---

## 🧠 생각해볼 거리

- structural sharing은 깊은 비교라 비용이 들어요. 데이터가 아주 크면 오히려 손해일 수 있는데, 언제 끄는 게 맞을까요?
- `select`를 매 렌더마다 인라인 화살표 함수로 넘기면 어떤 문제가 생길까요? (참조가 매번 바뀜 → 어떻게 방어할까요?)
- TanStack Query는 왜 `select` 결과에도 structural sharing을 적용할까요?
- 이 최적화들이 없을 때와 있을 때, 1초에 한 번 polling하는 대시보드의 체감 차이를 상상해보세요.
