export type QueryKey = readonly unknown[];

function replacer(_key: string, value: any) {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const keys = Object.keys(value).sort();

    const newObj: Record<string, any> = {};
    for (const key of keys) {
      newObj[key] = value[key];
    }

    return newObj;
  }

  return value;
}

// 배열 queryKey를 결정적 문자열로 변환
// 힌트: JSON.stringify의 replacer로 객체 키를 정렬하면 순서 무관해져요
export function hashKey(queryKey: QueryKey): string {
  return JSON.stringify(queryKey, replacer);
}
console.log(hashKey(['post', replacer]));
