/**
 * Gamification XP Unit Tests
 * 
 * Covers:
 * - calculateLevel: level boundaries, overflow protection
 * - xpForLevel: XP thresholds
 * - calculateLevelProgress: 0-1 range, edge cases
 * - addXp: overflow protection, negative XP, NaN handling
 * - multiplyXp: overflow, multiplier clamping
 * - isValidXp / clampXp: bounds checking
 * - Constants: XP_PER_CHAPTER, MAX_XP
 */

jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  XP_PER_CHAPTER,
  XP_SERIES_COMPLETED,
  XP_DAILY_STREAK_BONUS,
  MAX_XP,
  SAFE_XP_MULTIPLIER_MAX,
  calculateLevel,
  xpForLevel,
  calculateLevelProgress,
  addXp,
  multiplyXp,
  isValidXp,
  clampXp,
} from '../gamification/xp';

// ==========================================
// Constants
// ==========================================
describe('XP Constants', () => {
  it('XP_PER_CHAPTER is exactly 1 (anti-abuse)', () => {
    expect(XP_PER_CHAPTER).toBe(1);
  });

  it('XP_SERIES_COMPLETED is 100', () => {
    expect(XP_SERIES_COMPLETED).toBe(100);
  });

  it('MAX_XP is safe integer boundary', () => {
    expect(MAX_XP).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(MAX_XP).toBe(999_999_999);
  });
});

// ==========================================
// calculateLevel
// ==========================================
describe('calculateLevel', () => {
  it('returns level 1 for 0 XP', () => {
    expect(calculateLevel(0)).toBe(1);
  });

  it('returns level 1 for XP < 100', () => {
    expect(calculateLevel(50)).toBe(1);
    expect(calculateLevel(99)).toBe(1);
  });

  it('returns level 2 at 100 XP', () => {
    expect(calculateLevel(100)).toBe(2);
  });

  it('returns level 3 at 400 XP', () => {
    expect(calculateLevel(400)).toBe(3);
  });

  it('handles large XP values', () => {
    const level = calculateLevel(1_000_000);
    expect(level).toBeGreaterThan(1);
    expect(Number.isFinite(level)).toBe(true);
  });

  it('clamps negative XP to 0 (level 1)', () => {
    expect(calculateLevel(-100)).toBe(1);
  });

  it('clamps XP above MAX_XP', () => {
    const levelAtMax = calculateLevel(MAX_XP);
    const levelAboveMax = calculateLevel(MAX_XP + 1_000_000);
    expect(levelAboveMax).toBe(levelAtMax);
  });
});

// ==========================================
// xpForLevel
// ==========================================
describe('xpForLevel', () => {
  it('returns 0 for level 1', () => {
    expect(xpForLevel(1)).toBe(0);
  });

  it('returns 0 for level 0 or negative', () => {
    expect(xpForLevel(0)).toBe(0);
    expect(xpForLevel(-1)).toBe(0);
  });

  it('returns 100 for level 2', () => {
    expect(xpForLevel(2)).toBe(100);
  });

  it('returns 400 for level 3', () => {
    expect(xpForLevel(3)).toBe(400);
  });

  it('is monotonically increasing', () => {
    for (let i = 2; i <= 20; i++) {
      expect(xpForLevel(i)).toBeGreaterThan(xpForLevel(i - 1));
    }
  });

  it('caps level to prevent overflow', () => {
    const result = xpForLevel(999999);
    expect(Number.isFinite(result)).toBe(true);
  });
});

// ==========================================
// calculateLevelProgress
// ==========================================
describe('calculateLevelProgress', () => {
  it('returns 0 at level start', () => {
    expect(calculateLevelProgress(0)).toBe(0);
  });

  it('returns value between 0 and 1', () => {
    const progress = calculateLevelProgress(150);
    expect(progress).toBeGreaterThanOrEqual(0);
    expect(progress).toBeLessThanOrEqual(1);
  });

  it('returns close to 1 just before leveling up', () => {
    // Level 2 starts at 100, level 3 at 400
    const progress = calculateLevelProgress(399);
    expect(progress).toBeGreaterThan(0.9);
  });

  it('handles negative XP', () => {
    expect(calculateLevelProgress(-10)).toBe(0);
  });
});

// ==========================================
// addXp — overflow protection
// ==========================================
describe('addXp', () => {
  it('adds XP normally', () => {
    expect(addXp(100, 50)).toBe(150);
  });

  it('clamps at MAX_XP', () => {
    expect(addXp(MAX_XP - 10, 100)).toBe(MAX_XP);
  });

  it('does not go below 0', () => {
    expect(addXp(50, -100)).toBe(0);
  });

  it('handles NaN currentXp', () => {
    expect(addXp(NaN, 100)).toBe(0);
  });

  it('handles NaN xpToAdd', () => {
    expect(addXp(100, NaN)).toBe(100);
  });

  it('handles Infinity', () => {
    expect(addXp(Infinity, 100)).toBeLessThanOrEqual(MAX_XP);
  });

  it('handles both values at MAX_XP', () => {
    expect(addXp(MAX_XP, MAX_XP)).toBe(MAX_XP);
  });

  it('handles zero addition', () => {
    expect(addXp(500, 0)).toBe(500);
  });
});

// ==========================================
// multiplyXp — overflow protection
// ==========================================
describe('multiplyXp', () => {
  it('multiplies XP normally', () => {
    expect(multiplyXp(100, 2)).toBe(200);
  });

  it('clamps multiplier to SAFE_XP_MULTIPLIER_MAX', () => {
    const result = multiplyXp(100, 999);
    expect(result).toBe(multiplyXp(100, SAFE_XP_MULTIPLIER_MAX));
  });

  it('clamps negative multiplier to 0', () => {
    expect(multiplyXp(100, -5)).toBe(0);
  });

  it('handles NaN inputs', () => {
    expect(multiplyXp(NaN, 2)).toBe(0);
    expect(multiplyXp(100, NaN)).toBe(100);
  });

  it('handles zero multiplier', () => {
    expect(multiplyXp(100, 0)).toBe(0);
  });

  it('result never exceeds MAX_XP', () => {
    expect(multiplyXp(MAX_XP, SAFE_XP_MULTIPLIER_MAX)).toBeLessThanOrEqual(MAX_XP);
  });

  it('floors fractional results', () => {
    expect(multiplyXp(10, 1.5)).toBe(15);
    expect(multiplyXp(7, 1.5)).toBe(10); // 7 * 1.5 = 10.5 → 10
  });
});

// ==========================================
// isValidXp
// ==========================================
describe('isValidXp', () => {
  it('returns true for valid XP values', () => {
    expect(isValidXp(0)).toBe(true);
    expect(isValidXp(100)).toBe(true);
    expect(isValidXp(MAX_XP)).toBe(true);
  });

  it('returns false for negative', () => {
    expect(isValidXp(-1)).toBe(false);
  });

  it('returns false for above MAX_XP', () => {
    expect(isValidXp(MAX_XP + 1)).toBe(false);
  });

  it('returns false for NaN', () => {
    expect(isValidXp(NaN)).toBe(false);
  });

  it('returns false for Infinity', () => {
    expect(isValidXp(Infinity)).toBe(false);
  });
});

// ==========================================
// clampXp
// ==========================================
describe('clampXp', () => {
  it('returns 0 for negative', () => {
    expect(clampXp(-100)).toBe(0);
  });

  it('returns MAX_XP for above max', () => {
    expect(clampXp(MAX_XP + 1000)).toBe(MAX_XP);
  });

  it('returns 0 for NaN', () => {
    expect(clampXp(NaN)).toBe(0);
  });

  it('returns value as-is when in range', () => {
    expect(clampXp(500)).toBe(500);
  });
});
