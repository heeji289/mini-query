# 데이터 페칭·캐싱 라이브러리 바닥부터 구현하기 (mini-query)

## 📋 과제 개요

- **목표**: TanStack Query 같은 서버 상태(server state) 라이브러리를 프레임워크 도움 없이 밑바닥부터 직접 구현해요.
- **결과물**: 동작하는 코드 (GitHub 레포) + 각 Step에서 측정/관찰한 내용 정리
- **기술 스택**: TypeScript, React 18+, Vite, (테스트용) Vitest, MSW
- **기한**: 1.5 ~ 2주

> 우리가 평소에 `useQuery({ queryKey, queryFn })` 한 줄로 쓰는 그 라이브러리가, 안에서 무슨 일을 하고 있는지를 직접 만들어보면서 이해하는 과제예요. "옵저버 패턴 위에 올라간 캐시 시스템"을 한 겹씩 쌓아 올립니다.

---

## 🎯 학습 목표

- 서버 상태와 클라이언트 상태가 왜 다르게 다뤄져야 하는지 설명할 수 있어요.
- 옵저버(pub/sub) 패턴으로 "여러 컴포넌트가 하나의 데이터를 공유하고 동기화되는" 구조를 직접 설계해요.
- `useSyncExternalStore`로 외부 store를 React에 안전하게 연결하는 법을 이해해요.
- 캐싱의 핵심 개념(`staleTime`, `gcTime`)과 캐시 무효화(invalidation)를 구현하며 체감해요.
- 요청 중복 제거(dedup), 레이스 컨디션 방지, 재시도/백오프 같은 비동기 코디네이션 문제를 직접 풀어요.
- 참조 안정성(structural sharing)이 왜 리렌더 최적화에 중요한지 실측해요.

---

## 📖 배경 지식

과제 전에 아래 질문들에 답할 수 있을 정도면 충분해요. 감이 안 오는 건 만들어 가면서 계속 고민해주세요.

### 서버 상태 vs 클라이언트 상태
- 폼 입력값 같은 클라이언트 상태와, 서버에서 가져온 데이터(server state)는 어떤 점이 다른가요?
- 서버 상태를 `useState` + `useEffect`로 관리할 때 생기는 문제들(중복 요청, 캐시 없음, 동기화 안 됨, 로딩/에러 분기 반복)은 무엇인가요?

### 옵저버 패턴
- 옵저버(Observer) / 발행-구독(Pub-Sub) 패턴이 뭔가요? Subject와 Observer의 역할은?
- "하나의 데이터, 여러 구독자"를 구현하려면 어떤 자료구조가 필요할까요?

### React 연동
- `useSyncExternalStore`는 왜 생겼나요? `useState`로 외부 store를 구독하면 어떤 문제(tearing 등)가 생기나요?
- `getSnapshot`이 매번 새로운 객체를 반환하면 어떤 일이 벌어지나요?

### 캐싱
- 캐시가 "stale(신선하지 않음)"하다는 게 무슨 뜻인가요? `staleTime`과 `gcTime(cacheTime)`은 각각 무엇을 제어하나요?
- "캐시 무효화는 컴퓨터 과학에서 어려운 문제 중 하나"라는 말은 왜 나왔을까요?

### 비동기 코디네이션
- 같은 데이터를 동시에 요청하는 컴포넌트가 3개면 네트워크 요청은 몇 번 나가야 할까요?
- 늦게 도착한 응답이 최신 데이터를 덮어쓰는 레이스 컨디션은 어떻게 막을 수 있나요?

---

## 🏗️ 최종 아키텍처

```
        ┌────────────────────────── QueryClient ──────────────────────────┐
        │                                                                  │
        │   ┌──────────────────────── QueryCache ────────────────────────┐ │
        │   │                                                            │ │
        │   │   Query("['posts']")          ← Subject (상태 + 캐시 보유) │ │
        │   │     state: { status, data, error, isFetching, dataUpdatedAt }│ │
        │   │     observers: [ QueryObserver, QueryObserver, ... ]        │ │
        │   │     promise (in-flight, dedup용)                            │ │
        │   │     gcTimer                                                 │ │
        │   │                                                            │ │
        │   │   Query("['posts', 1]")                                     │ │
        │   │   Query("['users']")                                        │ │
        │   └────────────────────────────────────────────────────────────┘ │
        └──────────────────────────────────────────────────────────────────┘
                      ▲ notify                       ▲ subscribe / unsubscribe
                      │                              │
        ┌─────────────┴──────────┐      ┌────────────┴───────────┐
        │ QueryObserver          │      │ QueryObserver          │
        │ (useQuery 인스턴스)    │      │ (useQuery 인스턴스)    │
        └─────────────┬──────────┘      └────────────┬───────────┘
                      │ useSyncExternalStore         │
                      ▼                              ▼
              <PostList /> 컴포넌트            <PostCount /> 컴포넌트
```

핵심 객체 4개:
- **QueryClient**: 진입점. QueryCache를 들고 있고, 전역 옵션(default staleTime 등)을 관리해요.
- **QueryCache**: queryKey 기준으로 Query 인스턴스들을 보관하는 저장소(Map).
- **Query**: 하나의 queryKey에 대한 상태/데이터/in-flight promise를 가진 **Subject**. 옵저버들에게 변경을 알려요.
- **QueryObserver**: `useQuery` 호출 하나에 대응. Query를 구독하고, 컴포넌트로 상태를 흘려보내요.

---

## ✅ 최종 목표 (이 코드가 동작해야 해요)

```tsx
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5000, gcTime: 60000 } },
});

function PostList() {
  const { data, status, isFetching, refetch } = useQuery({
    queryKey: ["posts"],
    queryFn: () => fetch("/api/posts").then((r) => r.json()),
  });

  if (status === "pending") return <p>로딩 중...</p>;
  if (status === "error") return <p>에러 발생</p>;

  return (
    <div>
      {isFetching && <span>갱신 중…</span>}
      <ul>{data.map((p) => <li key={p.id}>{p.title}</li>)}</ul>
      <button onClick={() => refetch()}>새로고침</button>
    </div>
  );
}

// 같은 화면에 PostList가 2개 있어도 네트워크 요청은 1번만 나가야 해요 (dedup)
// 5초 안에 다시 마운트되면 캐시를 즉시 보여주고, 백그라운드에서 갱신해요 (staleTime)
// 모든 PostList가 unmount되고 60초가 지나면 캐시가 메모리에서 사라져요 (gcTime)
```

---

## 📋 전체 Step 구성

각 Step은 이전 Step의 결과 위에 한 겹씩 쌓아 올려요. Step마다 브랜치를 파서 진행하는 걸 권장해요.

| Step | 주제 | 한 줄 설명 |
| --- | --- | --- |
| [**Step 1**](./steps/step1-observer.md) | 옵저버 골격 | QueryClient / QueryCache / Query / QueryObserver 뼈대를 만들고, React 없이 subscribe로 동작 확인 |
| [**Step 2**](./steps/step2-react.md) | React 연동 | `useQuery` + `useSyncExternalStore`로 컴포넌트에 연결. 같은 키를 쓰는 컴포넌트들이 상태를 공유하는지 확인 |
| [**Step 3**](./steps/step3-dedup.md) | 요청 중복 제거 & 레이스 컨디션 | in-flight Promise 공유로 dedup, 늦게 온 응답이 최신을 덮어쓰지 않게 방어 |
| [**Step 4**](./steps/step4-cache.md) | 캐싱 (staleTime / gcTime) | stale 판정 → 백그라운드 refetch, 마지막 구독자 해제 시 GC 타이머로 캐시 정리 |
| [**Step 5**](./steps/step5-refetch.md) | refetch 전략 & 무효화 | `refetch`, `invalidateQueries`, 윈도우 포커스 refetch, `retry` + 지수 백오프 |
| [**Step 6**](./steps/step6-optimization.md) | 참조 안정성 & 최적화 | structural sharing으로 내용이 같으면 같은 참조 유지, `select`로 부분 구독, 불필요 리렌더 측정 |
| [**Step 7 (챌린지)**](./steps/step7-challenge.md) | SSR & Mutation | `dehydrate`/`hydrate`, `useMutation`, `useSuspenseQuery` 중 골라서 |

> Step 1~6이 본 과제, Step 7은 시간이 남으면 도전해요. 절반만 소화해도 충분해요!

---

## 🚦 시작하기

```bash
# Vite + React + TS 템플릿으로 시작
npm create vite@latest mini-query -- --template react-ts
cd mini-query
npm install

# 테스트 / 목 서버 (선택)
npm install -D vitest @testing-library/react jsdom msw
```

폴더 구조 예시 (정답은 아니에요, 본인 판단으로 설계해주세요):

```
src/
├── lib/                  # 우리가 만드는 라이브러리
│   ├── QueryClient.ts
│   ├── QueryCache.ts
│   ├── Query.ts
│   ├── QueryObserver.ts
│   ├── useQuery.ts
│   └── QueryClientProvider.tsx
├── app/                  # 라이브러리를 검증하는 데모 앱
└── main.tsx
```

---

## ✅ 완료 정의 (Definition of Done)

- [ ] `useQuery`로 데이터를 가져오고 `status`(pending/error/success) 분기가 동작한다
- [ ] 같은 `queryKey`를 쓰는 컴포넌트가 여러 개여도 네트워크 요청은 1번만 나간다 (dedup)
- [ ] 한 곳에서 데이터가 갱신되면 같은 키를 구독하는 모든 컴포넌트가 함께 리렌더된다
- [ ] `staleTime` 안에서는 캐시를 즉시 보여주고, stale하면 백그라운드 refetch한다 (`isFetching`으로 확인)
- [ ] 마지막 구독자가 unmount되고 `gcTime`이 지나면 캐시가 메모리에서 제거된다
- [ ] `refetch` / `invalidateQueries`가 동작한다
- [ ] 실패 시 `retry` + 지수 백오프로 재시도한다
- [ ] 레이스 컨디션(늦게 온 응답이 최신을 덮어씀)이 발생하지 않는다
- [ ] DevTools React Profiler로, 관련 없는 데이터 변경 시 불필요한 리렌더가 없음을 확인했다
- [ ] 각 Step에서 "왜 이렇게 설계했는지"를 README나 커밋 메시지에 남겼다

---

## 📚 참고 자료

- TanStack Query 공식 문서 — https://tanstack.com/query/latest
- TanStack Query Advanced SSR — https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr
- React `useSyncExternalStore` — https://react.dev/reference/react/useSyncExternalStore
- TkDodo's Blog (TanStack Query 메인테이너) — https://tkdodo.eu/blog/practical-react-query
- "Inside React Query" (TkDodo) — https://tkdodo.eu/blog/inside-react-query
- MDN — Using the Cache / HTTP caching (개념 비교용) — https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching

> 각 주제가 깊고 넓으니 위 링크 외에도 직접 더 찾아보면서 학습해주세요. 이번 주도 화이팅! 💪
