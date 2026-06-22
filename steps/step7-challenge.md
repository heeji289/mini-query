# Step 7 (챌린지): SSR & Mutation & Suspense

> 💡 `step7/challenge` 브랜치를 `step6/optimization`에서 파서 진행해주세요. 시간이 남을 때 골라서 도전하세요 — 셋 다 안 해도 괜찮아요!

본 과제(Step 1~6)로 라이브러리의 핵심은 완성됐어요. 이번 Step은 "실무에서 진짜 쓰려면 더 필요한 것들"을
선택적으로 붙여보는 확장 과제예요. **A / B / C 중 끌리는 걸 골라서** 하세요.

---

## 🅰️ Challenge A: SSR — dehydrate / hydrate

기존 SSR 과제들과 이어지는 주제예요. 서버에서 미리 fetch한 캐시를 클라이언트로 넘겨서, 클라이언트가
**다시 fetch하지 않고** 그 데이터로 시작하게 만들어요.

### 📖 이해해야 할 내용
- **dehydrate**: 서버의 QueryCache를 직렬화 가능한 형태(JSON)로 추출하는 것. queryKey + data + dataUpdatedAt 등.
- **hydrate**: 클라이언트에서 그 JSON을 받아 QueryCache에 미리 채워 넣는 것.
- 서버 HTML에 `<script>window.__QUERY_STATE__ = {...}</script>` 형태로 실어 보내고, 클라이언트는 부팅 시 그걸 hydrate해요.
- hydrate된 데이터가 fresh면(`staleTime` 안) 클라이언트는 추가 요청을 안 해요. stale이면 백그라운드 갱신.

### 🔧 구현 내용
```ts
// 서버에서
function dehydrate(client: QueryClient): DehydratedState {
  // cache의 모든 Query를 { queryHash, queryKey, state } 배열로 직렬화
}

// 클라이언트에서
function hydrate(client: QueryClient, dehydrated: DehydratedState): void {
  // 각 항목으로 Query를 만들어 cache에 미리 주입 (state.dataUpdatedAt도 복원!)
}
```
- `dataUpdatedAt`을 꼭 복원하세요. 안 그러면 stale 판정이 틀어져요.
- (선택) 기존 `React + Fastify Streaming SSR` 과제와 결합해서, 실제 SSR 서버에 얹어보세요.

### ✅ 완료 기준
- [ ] 서버에서 fetch한 데이터가 HTML에 실려 오고, 클라이언트가 hydrate 후 추가 요청 없이 렌더한다 (View Source + Network로 확인)
- [ ] hydrate 시점에 stale이면 백그라운드 refetch가 일어난다

---

## 🅱️ Challenge B: useMutation

조회(query)가 아닌 **변경(mutation, POST/PUT/DELETE)**을 다루는 훅이에요. 쿼리와 생명주기가 달라요.

### 📖 이해해야 할 내용
- Mutation은 캐시 키로 공유되지 않아요. 보통 사용자의 명시적 액션(`mutate()` 호출)으로 1회 실행돼요.
- 상태: `idle → pending → success | error`.
- 성공 후 보통 관련 쿼리를 `invalidateQueries`로 무효화해요 (Step 5와 연결!).
- **낙관적 업데이트(optimistic update)**: 서버 응답을 기다리지 않고 UI를 먼저 바꾸고, 실패하면 롤백.

### 🔧 구현 내용
```ts
function useMutation<TData, TVars>(options: {
  mutationFn: (vars: TVars) => Promise<TData>;
  onSuccess?: (data: TData, vars: TVars) => void;
  onError?: (err: unknown, vars: TVars) => void;
}) {
  // mutate(vars) 호출 시 mutationFn 실행, status 관리
  // return { mutate, status, data, error, isPending }
}
```
- 낙관적 업데이트를 하려면 `onMutate`(이전 캐시 스냅샷 저장 + 캐시 미리 변경)와 실패 시 롤백을 설계하세요.
- 캐시를 직접 수정하는 `queryClient.setQueryData(queryKey, updater)` 도 이때 필요해져요. 만들어보세요.

### ✅ 완료 기준
- [ ] `mutate()`로 변경 요청을 보내고 idle/pending/success/error가 동작한다
- [ ] 성공 후 관련 query가 invalidate되어 목록이 자동 갱신된다
- [ ] (심화) 낙관적 업데이트 + 실패 시 롤백이 동작한다
- [ ] `setQueryData`로 캐시를 직접 갱신할 수 있다

---

## 🅲 Challenge C: useSuspenseQuery

`status` 분기 대신 React `<Suspense>`와 `<ErrorBoundary>`에 로딩/에러를 위임하는 버전이에요.

### 📖 이해해야 할 내용
- Suspense의 원리: 컴포넌트가 렌더 중 **Promise를 throw하면** React가 가장 가까운 `<Suspense>`의 fallback을 보여주고, Promise가 resolve되면 다시 렌더해요.
- 에러를 throw하면 가장 가까운 `<ErrorBoundary>`가 잡아요.
- 그래서 `useSuspenseQuery`는 `data`가 없으면(pending) **promise를 throw**, error면 **error를 throw**, 있으면 data를 반환해요.
- 기존 `CSR/SSR` 과제의 Suspense + Streaming과 직접 연결되는 개념이에요.

### 🔧 구현 내용
```ts
function useSuspenseQuery<T>(options) {
  const result = useQuery(options); // 내부적으로 재사용
  if (result.status === "pending") throw observer.fetchPromise(); // resolve되면 재렌더
  if (result.status === "error") throw result.error;
  return result; // 여기선 data가 항상 존재 (타입도 그렇게)
}
```
- 반환 타입에서 `data`가 `T | undefined`가 아니라 `T`가 되도록 타입을 좁혀보세요. (Suspense 버전의 큰 장점)

### ✅ 완료 기준
- [ ] `<Suspense fallback>`이 로딩을 처리하고, 컴포넌트엔 로딩 분기 코드가 없다
- [ ] `<ErrorBoundary>`가 에러를 처리한다
- [ ] 반환 타입의 `data`가 non-nullable이다

---

## 🏁 과제 전체 마무리 (회고)

다 끝냈다면, README 맨 아래에 짧은 회고를 남겨주세요. 이게 이 과제의 진짜 결과물이에요.

- 직접 만들어보니 TanStack Query의 어떤 설계 결정이 "아, 그래서 이렇게 했구나" 싶었나요?
- `staleTime`/`gcTime`/dedup/structural sharing 중 가장 구현이 까다로웠던 건 무엇이고 왜였나요?
- 앞으로 `useQuery`를 쓸 때 예전과 다르게 보이는 부분이 있다면?
- 우리 라이브러리가 TanStack Query 대비 **빠진 것**을 5개만 적어본다면? (=라이브러리의 복잡도가 어디서 오는지 감 잡기)
