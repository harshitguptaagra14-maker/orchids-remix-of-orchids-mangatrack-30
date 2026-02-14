/**
 * Security Unit Tests for api-utils.ts
 * 
 * Covers:
 * - sanitizeInput: XSS prevention
 * - validateOrigin: CSRF protection (including BUG H3 fix)
 * - isIpInRange: CIDR matching for IPv4/IPv6
 * - timingSafeEqual: constant-time comparison
 * - validateRequired: field validation (including BUG M4 fix)
 * - generateCsrfToken: cryptographic token generation (BUG L4 fix)
 * - getSafeRedirect: open redirect prevention
 * - htmlEncode: entity encoding
 * - maskSecrets: sensitive data masking
 * - validateUUID: format validation
 */

// Mock modules before imports
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
  sanitizeInput,
  htmlEncode,
  validateRequired,
  validateUUID,
  getSafeRedirect,
  timingSafeEqual,
  isIpInRange,
  generateCsrfToken,
  validateOrigin,
  maskSecrets,
  sanitizeText,
  sanitizeFilterArray,
  toTitleCase,
  ErrorCodes,
} from '../api-utils';
import { ApiError } from '../api-error';

// ==========================================
// sanitizeInput — XSS Prevention
// ==========================================
describe('sanitizeInput', () => {
  it('returns empty string for falsy input', () => {
    expect(sanitizeInput('')).toBe('');
  });

  it('strips <script> tags', () => {
    expect(sanitizeInput('<script>alert("xss")</script>')).not.toContain('<script');
    expect(sanitizeInput('<script>alert("xss")</script>')).not.toContain('alert');
  });

  it('strips <iframe> tags', () => {
    expect(sanitizeInput('<iframe src="evil.com"></iframe>')).not.toContain('<iframe');
  });

  it('strips event handler attributes', () => {
    const result = sanitizeInput('<div onmouseover="alert(1)">text</div>');
    expect(result).not.toMatch(/onmouseover\s*=/i);
  });

  it('strips javascript: protocol URIs', () => {
    const result = sanitizeInput('javascript:alert(1)');
    expect(result).not.toContain('javascript:');
  });

  it('strips data: protocol URIs', () => {
    const result = sanitizeInput('data:text/html,<script>alert(1)</script>');
    expect(result).not.toContain('data:');
  });

  it('preserves normal text', () => {
    expect(sanitizeInput('Hello World')).toBe('Hello World');
  });

  it('preserves emoticons like <3', () => {
    expect(sanitizeInput('I <3 manga')).toContain('<3');
  });

  it('truncates to maxLength', () => {
    const long = 'a'.repeat(200);
    expect(sanitizeInput(long, 100).length).toBeLessThanOrEqual(100);
  });

  it('strips null bytes', () => {
    expect(sanitizeInput('test\x00value')).toBe('testvalue');
  });

  it('handles nested malicious HTML', () => {
    const result = sanitizeInput('<object><embed><script>evil()</script></embed></object>');
    expect(result).not.toContain('<script');
    expect(result).not.toContain('<object');
    expect(result).not.toContain('<embed');
  });

  it('strips expression() CSS attacks', () => {
    const result = sanitizeInput('background: expression(alert(1))');
    expect(result).not.toContain('expression(');
  });

  it('strips dangerous HTML entities (encoded backtick/grave)', () => {
    const result = sanitizeInput('&#96;');
    expect(result).not.toMatch(/&#(x0*60|0*96);/i);
  });
});

// ==========================================
// htmlEncode
// ==========================================
describe('htmlEncode', () => {
  it('encodes all special characters', () => {
    expect(htmlEncode('&')).toBe('&amp;');
    expect(htmlEncode('<')).toBe('&lt;');
    expect(htmlEncode('>')).toBe('&gt;');
    expect(htmlEncode('"')).toBe('&quot;');
    expect(htmlEncode("'")).toBe('&#x27;');
    expect(htmlEncode('/')).toBe('&#x2F;');
  });

  it('encodes a full XSS string', () => {
    const encoded = htmlEncode('<script>alert("xss")</script>');
    expect(encoded).not.toContain('<');
    expect(encoded).not.toContain('>');
    expect(encoded).toContain('&lt;');
  });
});

// ==========================================
// validateRequired — BUG M4 fix
// ==========================================
describe('validateRequired', () => {
  it('throws for missing fields', () => {
    expect(() => validateRequired({}, ['name'])).toThrow('Missing required fields: name');
  });

  it('throws for null fields', () => {
    expect(() => validateRequired({ name: null }, ['name'])).toThrow('Missing required fields');
  });

  it('does NOT throw for falsy but present values (0, false, "")', () => {
    // BUG M4 FIX: 0, false, "" should NOT trigger missing field error
    expect(() => validateRequired({ count: 0 }, ['count'])).not.toThrow();
    expect(() => validateRequired({ flag: false }, ['flag'])).not.toThrow();
    expect(() => validateRequired({ name: '' }, ['name'])).not.toThrow();
  });

  it('passes when all required fields are present', () => {
    expect(() => validateRequired({ a: 1, b: 'hello' }, ['a', 'b'])).not.toThrow();
  });

  it('lists all missing fields in error message', () => {
    expect(() => validateRequired({}, ['a', 'b', 'c'])).toThrow('a, b, c');
  });
});

// ==========================================
// validateUUID
// ==========================================
describe('validateUUID', () => {
  it('accepts valid UUIDs', () => {
    expect(() => validateUUID('550e8400-e29b-41d4-a716-446655440000')).not.toThrow();
    expect(() => validateUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).not.toThrow();
  });

  it('rejects invalid UUIDs', () => {
    expect(() => validateUUID('not-a-uuid')).toThrow();
    expect(() => validateUUID('')).toThrow();
    expect(() => validateUUID('550e8400-e29b-41d4-a716')).toThrow();
  });

  it('uses custom field name in error', () => {
    expect(() => validateUUID('invalid', 'series_id')).toThrow('series_id');
  });
});

// ==========================================
// timingSafeEqual
// ==========================================
describe('timingSafeEqual', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqual('secret123', 'secret123')).toBe(true);
  });

  it('returns false for different strings', () => {
    expect(timingSafeEqual('secret123', 'secret456')).toBe(false);
  });

  it('returns false for different length strings', () => {
    expect(timingSafeEqual('short', 'muchlongerstring')).toBe(false);
  });

  it('returns false for empty vs non-empty', () => {
    expect(timingSafeEqual('', 'notempty')).toBe(false);
  });

  it('returns true for two empty strings', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('handles unicode strings', () => {
    expect(timingSafeEqual('日本語', '日本語')).toBe(true);
    expect(timingSafeEqual('日本語', '中文字')).toBe(false);
  });
});

// ==========================================
// isIpInRange — CIDR matching
// ==========================================
describe('isIpInRange', () => {
  describe('IPv4', () => {
    it('matches exact IP with /32', () => {
      expect(isIpInRange('127.0.0.1', '127.0.0.1/32')).toBe(true);
    });

    it('matches IP within /24 range', () => {
      expect(isIpInRange('192.168.1.50', '192.168.1.0/24')).toBe(true);
    });

    it('rejects IP outside /24 range', () => {
      expect(isIpInRange('192.168.2.1', '192.168.1.0/24')).toBe(false);
    });

    it('matches 10.0.0.0/8 private range', () => {
      expect(isIpInRange('10.255.255.255', '10.0.0.0/8')).toBe(true);
      expect(isIpInRange('11.0.0.1', '10.0.0.0/8')).toBe(false);
    });

    it('matches within /16 range', () => {
      expect(isIpInRange('192.168.0.1', '192.168.0.0/16')).toBe(true);
      expect(isIpInRange('192.169.0.1', '192.168.0.0/16')).toBe(false);
    });

    it('handles CIDR without slash (exact match)', () => {
      expect(isIpInRange('1.2.3.4', '1.2.3.4')).toBe(true);
      expect(isIpInRange('1.2.3.4', '1.2.3.5')).toBe(false);
    });
  });

  describe('IPv6', () => {
    it('matches exact IPv6 with /128', () => {
      expect(isIpInRange('::1', '::1/128')).toBe(true);
    });

    it('matches IPv6 within range', () => {
      expect(isIpInRange('2001:db8::1', '2001:db8::/32')).toBe(true);
    });

    it('rejects IPv6 outside range', () => {
      expect(isIpInRange('2001:db9::1', '2001:db8::/32')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns false for mismatched IP versions', () => {
      expect(isIpInRange('127.0.0.1', '::1/128')).toBe(false);
    });

    it('returns false for invalid IP', () => {
      expect(isIpInRange('not.an.ip', '10.0.0.0/8')).toBe(false);
    });

    it('returns false for invalid CIDR', () => {
      expect(isIpInRange('10.0.0.1', 'garbage')).toBe(false);
    });
  });
});

// ==========================================
// generateCsrfToken — BUG L4 fix
// ==========================================
describe('generateCsrfToken', () => {
  it('generates a token with timestamp.random format', () => {
    const token = generateCsrfToken();
    expect(token).toMatch(/^[a-z0-9]+\.[a-f0-9]{32}$/);
  });

  it('generates unique tokens on each call', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateCsrfToken()));
    expect(tokens.size).toBe(100);
  });

  it('uses cryptographic randomness (32 hex chars = 16 bytes)', () => {
    const token = generateCsrfToken();
    const randomPart = token.split('.')[1];
    expect(randomPart).toHaveLength(32); // 16 bytes = 32 hex chars
  });
});

// ==========================================
// validateOrigin — CSRF protection (BUG H3 fix)
// ==========================================
describe('validateOrigin', () => {
  const originalEnv = process.env.NODE_ENV;

  // Helper to create a mock Request with working headers.get()
  function mockRequest(method: string, headerMap: Record<string, string>): Request {
    const headers = new Map(Object.entries(headerMap));
    return {
      method,
      headers: {
        get: (key: string) => headers.get(key.toLowerCase()) ?? headers.get(key) ?? null,
      },
      url: 'http://localhost:3000/api/test',
    } as unknown as Request;
  }

  beforeEach(() => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', writable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: originalEnv, writable: true });
  });

  it('allows same-origin requests', () => {
    const req = mockRequest('POST', {
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
    });
    expect(() => validateOrigin(req)).not.toThrow();
  });

  it('rejects cross-origin POST without Origin (BUG H3 fix)', () => {
    const req = mockRequest('POST', { host: 'localhost:3000' });
    expect(() => validateOrigin(req)).toThrow(/CSRF/);
  });

  it('allows GET without Origin header', () => {
    const req = mockRequest('GET', { host: 'localhost:3000' });
    expect(() => validateOrigin(req)).not.toThrow();
  });

  it('allows mutation without Origin if Referer matches host', () => {
    const req = mockRequest('POST', {
      host: 'localhost:3000',
      referer: 'http://localhost:3000/some-page',
    });
    expect(() => validateOrigin(req)).not.toThrow();
  });

  it('rejects mutation without Origin when Referer is cross-origin', () => {
    const req = mockRequest('POST', {
      host: 'localhost:3000',
      referer: 'http://evil.com/attack',
    });
    expect(() => validateOrigin(req)).toThrow(/CSRF/);
  });

  it('skips validation in development mode', () => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'development', writable: true });
    const req = mockRequest('POST', {
      origin: 'http://evil.com',
      host: 'localhost:3000',
    });
    expect(() => validateOrigin(req)).not.toThrow();
  });
});

// ==========================================
// getSafeRedirect — Open Redirect Prevention
// ==========================================
describe('getSafeRedirect', () => {
  it('returns default for null/undefined', () => {
    expect(getSafeRedirect(null)).toBe('/library');
    expect(getSafeRedirect(undefined)).toBe('/library');
  });

  it('allows internal paths', () => {
    expect(getSafeRedirect('/library')).toBe('/library');
    expect(getSafeRedirect('/series/123')).toBe('/series/123');
  });

  it('blocks protocol-relative URLs', () => {
    expect(getSafeRedirect('//evil.com')).toBe('/library');
  });

  it('blocks external URLs', () => {
    expect(getSafeRedirect('https://evil.com')).toBe('/library');
  });

  it('uses custom default', () => {
    expect(getSafeRedirect(null, '/home')).toBe('/home');
  });
});

// ==========================================
// maskSecrets
// ==========================================
describe('maskSecrets', () => {
  it('masks password fields', () => {
    const result = maskSecrets({ password: 'secret123', name: 'John' });
    expect(result.password).toBe('********');
    expect(result.name).toBe('John');
  });

  it('masks nested secret fields', () => {
    const result = maskSecrets({ auth: { access_token: 'abc', api_key: 'xyz' } });
    expect(result.auth.access_token).toBe('********');
    expect(result.auth.api_key).toBe('********');
  });

  it('returns non-objects as-is', () => {
    expect(maskSecrets(null)).toBe(null);
    expect(maskSecrets('string')).toBe('string');
  });

  it('handles arrays', () => {
    const result = maskSecrets([{ token: 'abc' }]);
    expect(result[0].token).toBe('********');
  });
});

// ==========================================
// sanitizeText
// ==========================================
describe('sanitizeText', () => {
  it('trims and truncates', () => {
    expect(sanitizeText('  hello  ', 5)).toBe('hello');
    expect(sanitizeText('abcdef', 3)).toBe('abc');
  });

  it('returns empty for falsy input', () => {
    expect(sanitizeText('')).toBe('');
  });
});

// ==========================================
// toTitleCase
// ==========================================
describe('toTitleCase', () => {
  it('converts basic strings', () => {
    expect(toTitleCase('action')).toBe('Action');
    expect(toTitleCase('SHOUNEN')).toBe('Shounen');
  });

  it('handles special cases', () => {
    expect(toTitleCase('sci-fi')).toBe('Sci-Fi');
    expect(toTitleCase('boys love')).toBe("Boys' Love");
    expect(toTitleCase('girls love')).toBe("Girls' Love");
    expect(toTitleCase('post apocalyptic')).toBe('Post-Apocalyptic');
  });
});

// ==========================================
// sanitizeFilterArray
// ==========================================
describe('sanitizeFilterArray', () => {
  it('filters non-strings and empty strings', () => {
    const input = ['valid', '', 123 as any, null as any, 'also valid'];
    const result = sanitizeFilterArray(input);
    expect(result).toEqual(['valid', 'also valid']);
  });

  it('respects maxLength', () => {
    const input = Array.from({ length: 100 }, (_, i) => `item${i}`);
    expect(sanitizeFilterArray(input, 5)).toHaveLength(5);
  });

  it('returns empty array for non-array input', () => {
    expect(sanitizeFilterArray(null as any)).toEqual([]);
  });
});
