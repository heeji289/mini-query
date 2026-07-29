import {Query} from './Query';
import {hashKey, type QueryKey} from './utils';

export class QueryCache {
  private queries = new Map<string, Query>();

  // queryHash로 기존 Query를 찾고, 없으면 만들어서 등록한 뒤 반환
  build<T>(options: {queryKey: QueryKey; queryFn: () => Promise<T>}): Query<T> {
    const hashed = hashKey(options.queryKey);

    let query = this.queries.get(hashed);
    if (!query) {
      query = new Query({
        queryKey: options.queryKey,
        queryHash: hashed,
        queryFn: options.queryFn,
      });

      this.queries.set(hashed, query);
    }
    return query as Query<T>;
  }

  get(queryHash: string): Query | undefined {
    return this.queries.get(queryHash);
  }

  getAll(): Query[] {
    return [...this.queries.values()];
  }
}
