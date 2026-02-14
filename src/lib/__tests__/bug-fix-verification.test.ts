/**
 * Bug Fix Verification & Regression Tests
 * 
 * This file explicitly simulates each reported bug scenario to prove the fix works.
 * Each describe block maps to a specific bug ID from the audit report.
 * 
 * BUG H1: releaseLinkWorker missing from shutdown (verified via source inspection + static analysis)
 * BUG H3: CSRF Origin bypass when header missing (simulated below)
 * BUG L4: CSRF token uses Math.random() instead of crypto (simulated below)
 * BUG M1: Unnecessary request.clone() in progress route (verified via source inspection)
 * BUG M3: Feed rate limit uses IP instead of user ID (verified via source inspection)
 * BUG M4: validateRequired treats falsy values as missing (simulated below)
 */

// ============================================================================
// Mocks (must be before imports)
// ============================================================================
jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../redis', () => ({
  redis: null,
  waitForRedis: jest.fn(),
  REDIS_KEY_PREFIX: 'test:',
}));

jest.mock('../prisma', () => ({
  prisma: { auditLog: { create: jest.fn() } },
  isTransientError: jest.fn(() => false),
}));

jest.mock('../config/env-validation', () => ({
  getInternalApiSecret: jest.fn(() => 'test-secret'),
}));

jest.mock('../bug-fixes-extended', () => ({
  createResponseValidator: jest.fn(),
  checkMemoryBounds: jest.fn(() => ({ withinBounds: true })),
  getMemoryStats: jest.fn(() => ({ heapUsed: 0, heapTotal: 0, rss: 0 })),
  isFeatureEnabled: jest.fn(() => true),
}));

jest.mock('../scrapers', () => ({
  CircuitBreakerOpenError: class extends Error { constructor(m: string) { super(m); this.name = 'CircuitBreakerOpenError'; } },
  ScraperError: class extends Error { constructor(m: string) { super(m); this.name = 'ScraperError'; } },
}));

import {
  validateRequired,
  validateOrigin,
  generateCsrfToken,
  validateJsonSize,
} from '../api-utils';
import { ApiError } from '../api-error';
import * as crypto from 'crypto';

// Helper to create a mock Request with working headers.get()
function mockRequest(method: string, headerMap: Record<string, string>, url?: string): Request {
  const lowerHeaders = new Map<string, string>();
  for (const [k, v] of Object.entries(headerMap)) {
    lowerHeaders.set(k.toLowerCase(), v);
  }
  return {
    method,
    headers: {
      get: (key: string) => lowerHeaders.get(key.toLowerCase()) ?? null,
    },
    url: url || 'http://localhost:3000/api/test',
  } as unknown as Request;
}

// ============================================================================
// BUG H1: releaseLinkWorker missing from shutdown cleanup
// Verified via static source analysis — cannot be unit-tested without starting
// real BullMQ workers. We verify the source code directly.
// ============================================================================
describe('BUG H1: releaseLinkWorker in shutdown cleanup (static verification)', () => {
  it('releaseLinkWorker is present in workers/index.ts shutdown array', async () => {
    // Read the source file and verify the fix is in place
    const fs = await import('fs');
    const path = await import('path');
    const workerFilePath = path.resolve(__dirname, '../../workers/index.ts');
    const source = fs.readFileSync(workerFilePath, 'utf-8');

    // Verify releaseLinkWorker appears in the shutdown workers array
    // The pattern is: workers = [..., releaseLinkWorker]
    const shutdownSection = source.slice(source.indexOf('const workers = ['));
    expect(shutdownSection).toContain('releaseLinkWorker');

    // Verify 'ReleaseLinker' is in workerNames
    const workerNamesSection = source.slice(source.indexOf('const workerNames = ['));
    expect(workerNamesSection).toContain("'ReleaseLinker'");
  });

  it('releaseLinkWorker is initialized with setupWorkerListeners', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const workerFilePath = path.resolve(__dirname, '../../workers/index.ts');
    const source = fs.readFileSync(workerFilePath, 'utf-8');

    // Verify the worker is initialized
    expect(source).toContain("releaseLinkWorker = new Worker(");
    expect(source).toContain("setupWorkerListeners(releaseLinkWorker, 'ReleaseLinker')");
  });
});

// ============================================================================
// BUG H3: CSRF validateOrigin bypassed when no Origin header
// BEFORE FIX: Missing Origin header silently returned (no validation)
// AFTER FIX: Mutations (POST/PUT/PATCH/DELETE) with no Origin are rejected
//            unless Referer matches host
// ============================================================================
describe('BUG H3: CSRF Origin bypass when header missing', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', writable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: originalEnv, writable: true });
  });

  describe('Attack scenario: Attacker strips Origin header on mutation', () => {
    it('POST without Origin header is REJECTED (was silently allowed before fix)', () => {
      const req = mockRequest('POST', { host: 'myapp.com' });
      expect(() => validateOrigin(req)).toThrow(ApiError);
      expect(() => validateOrigin(req)).toThrow(/CSRF/);
    });

    it('PUT without Origin header is REJECTED', () => {
      const req = mockRequest('PUT', { host: 'myapp.com' });
      expect(() => validateOrigin(req)).toThrow(/CSRF/);
    });

    it('PATCH without Origin header is REJECTED', () => {
      const req = mockRequest('PATCH', { host: 'myapp.com' });
      expect(() => validateOrigin(req)).toThrow(/CSRF/);
    });

    it('DELETE without Origin header is REJECTED', () => {
      const req = mockRequest('DELETE', { host: 'myapp.com' });
      expect(() => validateOrigin(req)).toThrow(/CSRF/);
    });
  });

  describe('Legitimate scenario: Same-origin Referer fallback', () => {
    it('POST without Origin but with matching Referer is ALLOWED', () => {
      const req = mockRequest('POST', {
        host: 'myapp.com',
        referer: 'https://myapp.com/some-page',
      });
      expect(() => validateOrigin(req)).not.toThrow();
    });

    it('POST without Origin and cross-origin Referer is REJECTED', () => {
      const req = mockRequest('POST', {
        host: 'myapp.com',
        referer: 'https://evil.com/attack',
      });
      expect(() => validateOrigin(req)).toThrow(/CSRF/);
    });

    it('POST without Origin and no Referer at all is REJECTED', () => {
      const req = mockRequest('POST', { host: 'myapp.com' });
      expect(() => validateOrigin(req)).toThrow(/CSRF/);
    });
  });

  describe('Safe methods: GET/HEAD without Origin is normal', () => {
    it('GET without Origin is ALLOWED (browser default behavior)', () => {
      const req = mockRequest('GET', { host: 'myapp.com' });
      expect(() => validateOrigin(req)).not.toThrow();
    });

    it('HEAD without Origin is ALLOWED', () => {
      const req = mockRequest('HEAD', { host: 'myapp.com' });
      expect(() => validateOrigin(req)).not.toThrow();
    });

    it('OPTIONS without Origin is ALLOWED', () => {
      const req = mockRequest('OPTIONS', { host: 'myapp.com' });
      expect(() => validateOrigin(req)).not.toThrow();
    });
  });

  describe('Normal cross-origin: Origin present and matching', () => {
    it('POST with matching Origin is ALLOWED', () => {
      const req = mockRequest('POST', {
        host: 'myapp.com',
        origin: 'https://myapp.com',
      });
      expect(() => validateOrigin(req)).not.toThrow();
    });

    it('POST with mismatched Origin is REJECTED', () => {
      const req = mockRequest('POST', {
        host: 'myapp.com',
        origin: 'https://evil.com',
      });
      expect(() => validateOrigin(req)).toThrow(/CSRF|Origin/);
    });
  });

  describe('x-forwarded-host support for proxied environments', () => {
    it('POST with Origin matching x-forwarded-host is ALLOWED', () => {
      const req = mockRequest('POST', {
        host: 'internal-lb:8080',
        origin: 'https://myapp.com',
        'x-forwarded-host': 'myapp.com',
      });
      expect(() => validateOrigin(req)).not.toThrow();
    });

    it('POST with Referer matching x-forwarded-host is ALLOWED (no Origin)', () => {
      const req = mockRequest('POST', {
        host: 'internal-lb:8080',
        'x-forwarded-host': 'myapp.com',
        referer: 'https://myapp.com/page',
      });
      expect(() => validateOrigin(req)).not.toThrow();
    });
  });
});

// ============================================================================
// BUG L4: CSRF Token Generation Uses Math.random()
// BEFORE FIX: Math.random().toString(36).substring(2, 15) — predictable
// AFTER FIX: crypto.randomBytes(16).toString('hex') — cryptographically secure
// ============================================================================
describe('BUG L4: CSRF token uses crypto instead of Math.random()', () => {
  it('token random part is exactly 32 hex chars (16 bytes)', () => {
    const token = generateCsrfToken();
    const [timestamp, random] = token.split('.');
    expect(timestamp).toBeTruthy();
    expect(random).toMatch(/^[a-f0-9]{32}$/); // hex only, exactly 32 chars
  });

  it('token is NOT base36 format (which Math.random().toString(36) would produce)', () => {
    // Math.random().toString(36).substring(2, 15) produces base36: [a-z0-9]
    // crypto.randomBytes(16).toString('hex') produces hex: [a-f0-9]
    const tokens = Array.from({ length: 50 }, () => generateCsrfToken());
    for (const token of tokens) {
      const random = token.split('.')[1];
      // Hex chars only — no g-z characters (which base36 would include)
      expect(random).toMatch(/^[a-f0-9]+$/);
      // Length is always 32 (not variable like Math.random base36)
      expect(random).toHaveLength(32);
    }
  });

  it('tokens have high entropy (statistical uniqueness)', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateCsrfToken()));
    // All 1000 tokens should be unique
    expect(tokens.size).toBe(1000);
  });

  it('source code does NOT contain Math.random() in generateCsrfToken', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const apiUtilsPath = path.resolve(__dirname, '../api-utils.ts');
    const source = fs.readFileSync(apiUtilsPath, 'utf-8');

    // Find the generateCsrfToken function
    const fnStart = source.indexOf('export function generateCsrfToken');
    const fnEnd = source.indexOf('}', fnStart);
    const fnBody = source.slice(fnStart, fnEnd + 1);

    expect(fnBody).not.toContain('Math.random');
    expect(fnBody).toContain('crypto.randomBytes');
  });
});

// ============================================================================
// BUG M1: Unnecessary request.clone() in progress route
// validateJsonSize only reads Content-Length header, never the body.
// Cloning wastes memory by duplicating the body stream.
// ============================================================================
describe('BUG M1: validateJsonSize does not need request.clone()', () => {
  it('validateJsonSize only reads headers, not body', async () => {
    // Create a request with content-length header
    const req = mockRequest('POST', {
      'content-length': '500',
    });
    // Should not throw for size under limit
    await expect(validateJsonSize(req, 1024)).resolves.toBeUndefined();
  });

  it('validateJsonSize rejects based on content-length header alone', async () => {
    const req = mockRequest('POST', {
      'content-length': '2048',
    });
    await expect(validateJsonSize(req, 1024)).rejects.toThrow('Payload too large');
  });

  it('validateJsonSize works without content-length (no body access needed)', async () => {
    const req = mockRequest('POST', {});
    // No content-length header — should pass (no way to check without reading body)
    await expect(validateJsonSize(req, 1024)).resolves.toBeUndefined();
  });

  it('progress route source code does NOT use request.clone() for validateJsonSize', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const progressPath = path.resolve(__dirname, '../../app/api/library/[id]/progress/route.ts');
    const source = fs.readFileSync(progressPath, 'utf-8');

    // Find the validateJsonSize call
    const callIndex = source.indexOf('validateJsonSize(');
    expect(callIndex).toBeGreaterThan(-1);

    // Get the line containing the call
    const lineStart = source.lastIndexOf('\n', callIndex);
    const lineEnd = source.indexOf('\n', callIndex);
    const line = source.slice(lineStart, lineEnd).trim();

    // Should NOT contain .clone()
    expect(line).not.toContain('.clone()');
    // Should pass request directly
    expect(line).toContain('validateJsonSize(request,');
  });
});

// ============================================================================
// BUG M3: Feed route rate limit should use user ID
// BEFORE FIX: Uses IP only — shared NAT/VPN users hit same bucket
// AFTER FIX: Uses user.id when authenticated, falls back to IP
// ============================================================================
describe('BUG M3: Feed route rate limit uses user ID', () => {
  it('feed route source uses user.id for rate limit key when available', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const feedPath = path.resolve(__dirname, '../../app/api/feed/route.ts');
    const source = fs.readFileSync(feedPath, 'utf-8');

    // Verify the rate limit key construction uses user ID
    expect(source).toContain('user?.id');
    // Verify it falls back to IP
    expect(source).toMatch(/user\?\.id\s*\?\s*`feed:\$\{user\.id\}`\s*:\s*`feed:\$\{ip\}`/);
    // Verify getMiddlewareUser is called
    expect(source).toContain('getMiddlewareUser');
  });

  it('feed route does NOT use only IP for rate limiting', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const feedPath = path.resolve(__dirname, '../../app/api/feed/route.ts');
    const source = fs.readFileSync(feedPath, 'utf-8');

    // The old pattern was: checkRateLimit(`feed:${ip}`, ...)
    // Make sure there's no rate limit call that ONLY uses IP
    const rateLimitCalls = source.match(/checkRateLimit\(`feed:\$\{ip\}`/g);
    expect(rateLimitCalls).toBeNull(); // Should NOT exist anymore
  });
});

// ============================================================================
// BUG M4: validateRequired treats falsy values as missing
// BEFORE FIX: !data[field] → 0, false, "" treated as missing
// AFTER FIX: data[field] === undefined || data[field] === null
// ============================================================================
describe('BUG M4: validateRequired handles falsy values correctly', () => {
  describe('Values that SHOULD be accepted (falsy but present)', () => {
    it('accepts 0 as a valid value', () => {
      expect(() => validateRequired({ chapter: 0 }, ['chapter'])).not.toThrow();
    });

    it('accepts false as a valid value', () => {
      expect(() => validateRequired({ enabled: false }, ['enabled'])).not.toThrow();
    });

    it('accepts empty string as a valid value', () => {
      expect(() => validateRequired({ notes: '' }, ['notes'])).not.toThrow();
    });

    it('accepts NaN as a valid value (it is not null/undefined)', () => {
      expect(() => validateRequired({ score: NaN }, ['score'])).not.toThrow();
    });
  });

  describe('Values that SHOULD be rejected (null/undefined)', () => {
    it('rejects undefined', () => {
      expect(() => validateRequired({ chapter: undefined }, ['chapter'])).toThrow('Missing required fields');
    });

    it('rejects null', () => {
      expect(() => validateRequired({ chapter: null }, ['chapter'])).toThrow('Missing required fields');
    });

    it('rejects missing key entirely', () => {
      expect(() => validateRequired({}, ['chapter'])).toThrow('Missing required fields');
    });
  });

  describe('Real-world regression scenarios', () => {
    it('last_read_chapter: 0 should NOT trigger missing field error', () => {
      // This was the actual bug: users setting chapter to 0 got a validation error
      const data = { series_id: 'abc-123', last_read_chapter: 0, status: 'reading' };
      expect(() => validateRequired(data, ['series_id', 'last_read_chapter', 'status'])).not.toThrow();
    });

    it('is_public: false should NOT trigger missing field error', () => {
      const data = { name: 'My List', is_public: false };
      expect(() => validateRequired(data, ['name', 'is_public'])).not.toThrow();
    });

    it('mixed null and valid falsy values', () => {
      const data = { a: 0, b: null, c: false, d: '' };
      expect(() => validateRequired(data, ['a', 'b', 'c', 'd'])).toThrow('Missing required fields: b');
    });
  });
});

// ============================================================================
// Cross-cutting: Verify crypto import is available
// ============================================================================
describe('Crypto availability', () => {
  it('crypto.randomBytes is available for CSRF tokens', () => {
    const bytes = crypto.randomBytes(16);
    expect(bytes).toHaveLength(16);
    expect(bytes.toString('hex')).toHaveLength(32);
  });
});
