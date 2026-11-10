import { allowedTargets, assertTransition, canTransition, isTerminal } from '../src/domain/index.js';

describe('payment state machine', () => {
  it('allows the happy path', () => {
    expect(canTransition('initiated', 'validated')).toBe(true);
    expect(canTransition('validated', 'screened')).toBe(true);
    expect(canTransition('screened', 'submitted')).toBe(true);
    expect(canTransition('submitted', 'settled')).toBe(true);
    expect(canTransition('settled', 'reversed')).toBe(true);
  });

  it('allows failure from every non-terminal working state', () => {
    for (const from of ['initiated', 'validated', 'screened', 'submitted'] as const) {
      expect(canTransition(from, 'failed')).toBe(true);
    }
    expect(canTransition('settled', 'failed')).toBe(false);
    expect(canTransition('failed', 'validated')).toBe(false);
  });

  it('rejects illegal jumps', () => {
    expect(canTransition('initiated', 'submitted')).toBe(false);
    expect(canTransition('initiated', 'settled')).toBe(false);
    expect(() => assertTransition('initiated', 'settled')).toThrow(/illegal transition/);
  });

  it('marks failed and reversed as terminal', () => {
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('reversed')).toBe(true);
    expect(isTerminal('submitted')).toBe(false);
    expect(allowedTargets('reversed')).toEqual([]);
  });
});
