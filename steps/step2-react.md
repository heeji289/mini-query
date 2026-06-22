# Step 2: React 연동 — useQuery & useSyncExternalStore

> 💡 `step2/react-binding` 브랜치를 `step1/observer-core`에서 파서 진행해주세요.

Step 1에서 만든 framework-agnostic 코어를, 이제 React에 연결해요.
핵심은 **"코어는 그대로 두고, React는 얇은 어댑터로만 붙인다"** 예요. `useQuery`가 하는 일은 사실
"QueryObserver를 만들고, 그걸 `useSyncExternalStore`로 구독하는 것"이 전부에 가까워요.

---

## 📖 이해해야 할 내용

### `useSyncExternalStore`는 왜 필요한가
- React 외부에 있는 store(우리 `Query`)를 컴포넌트가 구독하려면, "값이 바뀌었으니 다시 그려"라고 React에게 알려야 해요.
- 예전엔 `useState` + `useEffect`로 흉내 냈지만, Concurrent 렌더링에서 **tearing**(같은 store인데 컴포넌트마다 다른 값을 보는 현상)이 생길 수 있어요.
- `useSyncExternalStore(subscribe, getSnapshot)`는 이 문제를 React가 보장해주는 공식 API예요.
  - `subscribe(onStoreChange)`: store를 구독하고, 변경 시 `onStoreChange`를 부르고, **cleanup을 반환**해야 해요. (Step 1에서 `subscribe`가 cleanup을 반환하게 설계한 이유!)
  - `getSnapshot()`: 현재 값을 반환. **여기서 매번 새 객체를 반환하면 무한 렌더링**이 나요.

### getSnapshot의 함정 (중요)
- React는 `getSnapshot()`의 반환값을 이전 값과 `Object.is`로 비교해요. 다르면 리렌더해요.
- 만약 `getSnapshot`이 `return { ...query.state }` 처럼 매번 새 객체를 만들면, 항상 다르다고 판단해서 **무한 루프**가 돼요.
- 해결: Query 내부에서 state가 바뀔 때만 새 객체를 만들고(Step 1의 불변 갱신!), `getSnapshot`은 그 **동일 참조를 그대로 반환**해야 해요.

### Provider로 QueryClient 주입
- 컴포넌트들이 같은 `QueryClient`(= 같은 캐시)를 공유하려면 Context로 내려줘야 해요.
- `QueryClientProvider`로 감싸고, `useQueryClient()` 훅으로 꺼내 쓰는 패턴이에요.

### Observer의 생명주기와 React 렌더링
- `useQuery`가 호출될 때마다 새 Observer를 만들면 안 돼요. 컴포넌트 인스턴스당 Observer 1개를 유지해야 해요. (힌트: `useState(() => new QueryObserver(...))` 또는 `useRef`)
- 옵션(`queryKey`)이 렌더 중에 바뀌면 Observer가 어떻게 반응해야 할까요? (지금은 단순하게, 심화는 Step 5에서.)

---

## 🔧 구현 내용

### 1단계: QueryClientProvider & useQueryClient

```tsx
// lib/QueryClientProvider.tsx
const QueryClientContext = createContext<QueryClient | undefined>(undefined);

export function QueryClientProvider({ client, children }: { client: QueryClient; children: ReactNode }) {
  // Context.Provider로 client 내려주기
}

export function useQueryClient(): QueryClient {
  // Context에서 꺼내고, 없으면 에러 throw ("Provider로 감싸세요")
}
```

### 2단계: useQuery

```tsx
// lib/useQuery.ts
export function useQuery<T>(options: { queryKey: QueryKey; queryFn: () => Promise<T> }) {
  const client = useQueryClient();

  // 1) 컴포넌트 인스턴스당 Observer 하나 유지
  const [observer] = useState(() => new QueryObserver<T>(client, options));

  // 2) useSyncExternalStore로 구독
  useSyncExternalStore(
    useCallback((onStoreChange) => observer.subscribe(onStoreChange), [observer]),
    () => observer.getResult(),   // ← 동일 참조 반환이 보장되어야 함!
  );

  // 3) 현재 결과 반환 (data, status, isFetching, error 등)
  return observer.getResult();
}
```

> `getResult()`가 매번 새 객체를 만들지 않도록, Observer 내부에 "마지막 결과"를 캐싱했다가 state가 바뀐 경우에만 새로 계산하게 만들어보세요. (이게 Step 6의 structural sharing 으로 이어져요.)

### 3단계: 데모 앱으로 검증

`src/app/`에 실제 컴포넌트를 만들어 확인해요. JSONPlaceholder를 써도 좋아요.

```tsx
function Posts() {
  const { data, status, isFetching } = useQuery({
    queryKey: ["posts"],
    queryFn: () => fetch("https://jsonplaceholder.typicode.com/posts").then((r) => r.json()),
  });
  if (status === "pending") return <p>로딩…</p>;
  if (status === "error") return <p>에러</p>;
  return <ul>{isFetching && <span>갱신중</span>}{data.map((p) => <li key={p.id}>{p.title}</li>)}</ul>;
}

function App() {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <Posts />
      <Posts />  {/* 같은 키를 쓰는 컴포넌트 2개 */}
    </QueryClientProvider>
  );
}
```

검증 포인트:
- 로딩 → 성공으로 화면이 자동 전환되나요?
- `<Posts />`가 2개인데 화면 두 곳이 **동시에** 같은 데이터로 갱신되나요? (= 같은 Query를 공유)
- 한쪽에서 데이터가 도착하면 다른 쪽도 함께 리렌더되나요? (React DevTools로 확인)

---

## ✅ 완료 기준 (Definition of Done)

- [ ] `QueryClientProvider` 없이 `useQuery`를 쓰면 명확한 에러가 난다
- [ ] `useQuery`가 `useSyncExternalStore` 기반으로 동작한다 (`useEffect`로 흉내내지 않음)
- [ ] 로딩/성공/에러 상태가 화면에 자동으로 반영된다
- [ ] 같은 키를 쓰는 컴포넌트 2개가 같은 데이터로 동기화된다
- [ ] `getSnapshot`(=`getResult`)이 동일 참조를 반환해서 무한 렌더링이 없다
- [ ] 컴포넌트가 리렌더돼도 Observer 인스턴스는 재사용된다 (매 렌더마다 새로 안 만듦)

---

## 🧠 생각해볼 거리

- `getSnapshot`이 새 객체를 반환할 때 정확히 왜 무한 루프가 나는지, React 입장에서 단계별로 설명할 수 있나요?
- SSR 환경이라면 `getServerSnapshot`이 왜 따로 필요할까요? (Step 7 SSR의 복선)
- Observer를 `useState(() => ...)`로 만든 것과 `useMemo`로 만든 것의 차이는? (React는 `useMemo` 결과를 버릴 수 있다는 점을 떠올려보세요.)
