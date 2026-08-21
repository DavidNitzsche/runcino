import { describe, it, expect } from 'vitest';
import { withRequestMemo, memo, memoDrop, memoSize } from './request-memo';

describe('request-memo', () => {
  it('is a pass-through with no scope · an un-wrapped caller keeps today behavior', async () => {
    let calls = 0;
    const read = () => { calls++; return Promise.resolve(calls); };
    await memo('k', read);
    await memo('k', read);
    expect(calls).toBe(2);
    expect(memoSize()).toBe(0);
  });

  it('answers once per key inside a scope', async () => {
    let calls = 0;
    const read = () => { calls++; return Promise.resolve('v' + calls); };
    const out = await withRequestMemo(async () => [
      await memo('k', read), await memo('k', read), await memo('k', read),
    ]);
    expect(calls).toBe(1);
    expect(out).toEqual(['v1', 'v1', 'v1']);
  });

  it('keys are independent', async () => {
    let calls = 0;
    const read = () => { calls++; return Promise.resolve(calls); };
    await withRequestMemo(async () => { await memo('a', read); await memo('b', read); await memo('a', read); });
    expect(calls).toBe(2);
  });

  it('collapses CONCURRENT duplicates onto one in-flight read', async () => {
    let calls = 0;
    const read = () => { calls++; return new Promise((r) => setTimeout(() => r(calls), 10)); };
    await withRequestMemo(async () => Promise.all([memo('k', read), memo('k', read), memo('k', read)]));
    expect(calls).toBe(1);
  });

  it('does NOT leak between scopes · two requests read fresh', async () => {
    let calls = 0;
    const read = () => { calls++; return Promise.resolve(calls); };
    const a = await withRequestMemo(() => memo('k', read));
    const b = await withRequestMemo(() => memo('k', read));
    expect(a).toBe(1);
    expect(b).toBe(2);
  });

  it('does not cache a rejection', async () => {
    let calls = 0;
    const read = () => { calls++; return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve('ok'); };
    await withRequestMemo(async () => {
      await expect(memo('k', read)).rejects.toThrow('boom');
      expect(await memo('k', read)).toBe('ok');
    });
    expect(calls).toBe(2);
  });

  it('memoDrop lets a writer expose its own write to a later read', async () => {
    let value = 'before';
    let calls = 0;
    const read = () => { calls++; return Promise.resolve(value); };
    await withRequestMemo(async () => {
      expect(await memo('k', read)).toBe('before');
      value = 'after';
      expect(await memo('k', read)).toBe('before');   // still memoized
      memoDrop('k');
      expect(await memo('k', read)).toBe('after');    // writer dropped it
    });
    expect(calls).toBe(2);
  });

  it('a nested scope reuses the outer one rather than starting a second cache', async () => {
    let calls = 0;
    const read = () => { calls++; return Promise.resolve(calls); };
    await withRequestMemo(async () => {
      await memo('k', read);
      await withRequestMemo(() => memo('k', read));
    });
    expect(calls).toBe(1);
  });
});
