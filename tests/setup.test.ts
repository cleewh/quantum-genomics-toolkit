import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

describe('Project Setup', () => {
  it('vitest is configured correctly', () => {
    expect(true).toBe(true);
  });

  it('fast-check is available', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        return typeof n === 'number';
      }),
      { numRuns: 10 }
    );
  });
});
