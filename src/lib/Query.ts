import type {QueryKey} from './utils';

export type QueryStatus = 'pending' | 'error' | 'success';

export interface QueryState<T> {
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
  private observers: Array<() => void> = [];
  private queryFn: () => Promise<T>;

  constructor(config: {
    queryKey: QueryKey;
    queryHash: string;
    queryFn: () => Promise<T>;
  }) {
    this.queryKey = config.queryKey;
    this.queryHash = config.queryHash;
    this.queryFn = config.queryFn;
    this.state = {
      status: 'pending',
      data: undefined,
      dataUpdatedAt: 0,
      error: undefined,
      isFetching: false,
    };
  }

  subscribe(listener: () => void): () => void {
    this.observers.push(listener);

    // unscribe 함수를 리턴 (this를 코드 작성 시점으로 제한하기 위해 익명 함수로 반환)
    return () => {
      this.observers = this.observers.filter((l) => l !== listener);
    };
  }

  private setState(updater: (prev: QueryState<T>) => QueryState<T>): void {
    this.state = updater(this.state);
    // observer들에게 알림
    this.notify();
  }

  private notify(): void {
    this.observers.forEach((observer) => observer());
  }

  async fetch(): Promise<T> {
    this.setState((prev) => ({...prev, isFetching: true}));

    try {
      const result = await this.queryFn();
      this.setState((prev) => ({
        ...prev,
        status: 'success',
        data: result,
        dataUpdatedAt: Date.now(),
      }));
      return result;
    } catch (err) {
      this.setState((prev) => ({...prev, status: 'error', error: err}));
      throw err;
    } finally {
      this.setState((prev) => ({...prev, isFetching: false}));
    }
  }
}
