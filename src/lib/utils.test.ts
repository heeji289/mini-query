import {describe, expect, it} from 'vitest';
import {hashKey} from './utils';

describe('hashKey', () => {
  it('같은 키는 같은 문자열로 변환된다', () => {
    expect(hashKey(['post', 1])).toBe(hashKey(['post', 1]));
  });

  it('객체 속성 순서가 달라도 같은 키다', () => {
    expect(hashKey(['post', {sort: 'latest', page: 2, category: 'sofa'}])).toBe(
      hashKey(['post', {sort: 'latest', category: 'sofa', page: 2}]),
    );
  });

  it('중첩 객체의 속성 순서도 무관하다', () => {
    expect(hashKey(['post', {filter: {y: 1, x: 2}}])).toBe(
      hashKey(['post', {filter: {x: 2, y: 1}}]),
    );
  });

  it('배열 순서는 유저가 입력한 대로 구분된다', () => {
    expect(hashKey(['post', 1])).not.toBe(hashKey([1, 'post']));
  });

  it('null은 안전하게 직렬화된다', () => {
    expect(hashKey(['post', null])).toBe('["post",null]');
  });

  it('직렬화 불가능한 값(함수, undefined)은 null로 직렬화된다', () => {
    expect(hashKey(['post', undefined])).toBe('["post",null]');
    expect(hashKey(['post', () => 1])).toBe('["post",null]');
  });
});
