/**
 * Auth Circuit Breaker Unit Tests
 * 
 * Covers:
 * - State transitions: CLOSED → OPEN → HALF_OPEN → CLOSED
 * - Failure window reset
 * - Half-open single-failure reopen
 * - configureCircuitBreaker
 * - withCircuitBreaker wrapper
 * - getCircuitMetrics
 */

jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  configureCircuitBreaker,
  getCircuitState,
  canMakeAuthRequest,
  recordAuthSuccess,
  recordAuthFailure,
  resetCircuit,
  getCircuitMetrics,
  withCircuitBreaker,
} from '../auth-circuit-breaker';

describe('AuthCircuitBreaker', () => {
  beforeEach(() => {
    resetCircuit();
    configureCircuitBreaker({
      failureThreshold: 3,
      openDurationMs: 100,
      successThreshold: 2,
      failureWindowMs: 5000,
    });
  });

  // ==========================================
  // CLOSED state
  // ==========================================
  describe('CLOSED state', () => {
    it('starts in CLOSED state', () => {
      expect(getCircuitState().state).toBe('CLOSED');
    });

    it('allows requests when CLOSED', () => {
      expect(canMakeAuthRequest()).toBe(true);
    });

    it('stays CLOSED after successes', () => {
      recordAuthSuccess();
      recordAuthSuccess();
      recordAuthSuccess();
      expect(getCircuitState().state).toBe('CLOSED');
    });

    it('stays CLOSED with failures below threshold', () => {
      recordAuthFailure();
      recordAuthFailure();
      expect(getCircuitState().state).toBe('CLOSED');
      expect(canMakeAuthRequest()).toBe(true);
    });
  });

  // ==========================================
  // CLOSED → OPEN transition
  // ==========================================
  describe('CLOSED → OPEN', () => {
    it('opens after threshold consecutive failures', () => {
      recordAuthFailure();
      recordAuthFailure();
      recordAuthFailure();
      expect(getCircuitState().state).toBe('OPEN');
    });

    it('blocks requests when OPEN', () => {
      recordAuthFailure();
      recordAuthFailure();
      recordAuthFailure();
      expect(canMakeAuthRequest()).toBe(false);
    });

    it('resets failure count on success', () => {
      recordAuthFailure();
      recordAuthFailure();
      recordAuthSuccess(); // resets count
      recordAuthFailure(); // only 1 failure now
      expect(getCircuitState().state).toBe('CLOSED');
    });
  });

  // ==========================================
  // OPEN → HALF_OPEN transition
  // ==========================================
  describe('OPEN → HALF_OPEN', () => {
    it('transitions to HALF_OPEN after openDurationMs', async () => {
      recordAuthFailure();
      recordAuthFailure();
      recordAuthFailure();
      expect(getCircuitState().state).toBe('OPEN');

      // Wait for open duration
      await new Promise(r => setTimeout(r, 150));

      // getCircuitState calls updateCircuitState internally
      expect(getCircuitState().state).toBe('HALF_OPEN');
    });

    it('allows requests in HALF_OPEN', async () => {
      recordAuthFailure();
      recordAuthFailure();
      recordAuthFailure();

      await new Promise(r => setTimeout(r, 150));

      expect(canMakeAuthRequest()).toBe(true);
    });
  });

  // ==========================================
  // HALF_OPEN → CLOSED (recovery)
  // ==========================================
  describe('HALF_OPEN → CLOSED', () => {
    it('closes after enough successes in HALF_OPEN', async () => {
      recordAuthFailure();
      recordAuthFailure();
      recordAuthFailure();

      await new Promise(r => setTimeout(r, 150));
      expect(getCircuitState().state).toBe('HALF_OPEN');

      recordAuthSuccess();
      recordAuthSuccess(); // successThreshold = 2
      expect(getCircuitState().state).toBe('CLOSED');
    });
  });

  // ==========================================
  // HALF_OPEN → OPEN (failure during recovery)
  // ==========================================
  describe('HALF_OPEN → OPEN', () => {
    it('reopens on any failure during HALF_OPEN', async () => {
      recordAuthFailure();
      recordAuthFailure();
      recordAuthFailure();

      await new Promise(r => setTimeout(r, 150));
      expect(getCircuitState().state).toBe('HALF_OPEN');

      recordAuthFailure();
      expect(getCircuitState().state).toBe('OPEN');
    });
  });

  // ==========================================
  // Failure window reset
  // ==========================================
  describe('failure window', () => {
    it('resets failure count when failures are outside the window', async () => {
      configureCircuitBreaker({ failureWindowMs: 50 });

      recordAuthFailure();
      recordAuthFailure();

      // Wait for window to expire
      await new Promise(r => setTimeout(r, 100));

      // This failure resets the count (was outside window)
      recordAuthFailure();
      // Only 1 failure in current window, not 3
      expect(getCircuitState().state).toBe('CLOSED');
    });
  });

  // ==========================================
  // getCircuitMetrics
  // ==========================================
  describe('getCircuitMetrics', () => {
    it('reports healthy when CLOSED', () => {
      const metrics = getCircuitMetrics();
      expect(metrics.isHealthy).toBe(true);
      expect(metrics.state).toBe('CLOSED');
      expect(metrics.failureCount).toBe(0);
    });

    it('reports unhealthy when OPEN', () => {
      recordAuthFailure();
      recordAuthFailure();
      recordAuthFailure();
      const metrics = getCircuitMetrics();
      expect(metrics.isHealthy).toBe(false);
      expect(metrics.state).toBe('OPEN');
      expect(metrics.timeSinceOpened).not.toBeNull();
    });
  });

  // ==========================================
  // withCircuitBreaker wrapper
  // ==========================================
  describe('withCircuitBreaker', () => {
    it('executes function and records success', async () => {
      const result = await withCircuitBreaker(() => Promise.resolve('data'));
      expect(result.result).toBe('data');
      expect(result.circuitOpen).toBe(false);
    });

    it('returns fallback when circuit is open', async () => {
      recordAuthFailure();
      recordAuthFailure();
      recordAuthFailure();

      const result = await withCircuitBreaker(
        () => Promise.resolve('data'),
        'fallback'
      );
      expect(result.result).toBe('fallback');
      expect(result.circuitOpen).toBe(true);
    });

    it('records failure when function throws', async () => {
      const result = await withCircuitBreaker(
        () => Promise.reject(new Error('auth down'))
      );
      expect(result.result).toBeNull();
      expect(result.error).toBeInstanceOf(Error);
      expect(getCircuitState().failureCount).toBe(1);
    });

    it('returns null when circuit open and no fallback', async () => {
      recordAuthFailure();
      recordAuthFailure();
      recordAuthFailure();

      const result = await withCircuitBreaker(() => Promise.resolve('data'));
      expect(result.result).toBeNull();
      expect(result.circuitOpen).toBe(true);
    });
  });

  // ==========================================
  // resetCircuit
  // ==========================================
  describe('resetCircuit', () => {
    it('resets from OPEN to CLOSED', () => {
      recordAuthFailure();
      recordAuthFailure();
      recordAuthFailure();
      expect(getCircuitState().state).toBe('OPEN');

      resetCircuit();
      expect(getCircuitState().state).toBe('CLOSED');
      expect(getCircuitState().failureCount).toBe(0);
    });
  });
});
