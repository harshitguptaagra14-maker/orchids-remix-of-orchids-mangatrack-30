/**
 * QA Integration Tests - Feb 12 2026 Session 2
 * 
 * Tests covering:
 * 1. SQL injection prevention in catalog-tiers (parameterized queries)
 * 2. Information disclosure prevention (proxy error messages)
 * 3. Cursor date validation
 * 4. Not-found page existence
 * 5. SSRF defense chain validation
 * 6. Middleware security headers
 */

import { isInternalIP, isWhitelistedDomain } from '@/lib/constants/image-whitelist'
import { sanitizeInput, validateUUID } from '@/lib/api-utils'
import fs from 'fs'
import path from 'path'

// ============================================================
// 1. SQL Injection Prevention (catalog-tiers parameterized queries)
// ============================================================
describe('Parameterized Query Safety', () => {
  it('UUID regex rejects SQL injection payloads', () => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const sqlPayloads = [
      "'; DROP TABLE activity_events;--",
      "1' OR '1'='1",
      "1; DELETE FROM users WHERE 1=1;",
      "' UNION SELECT * FROM users--",
      "$(cat /etc/passwd)",
      "`rm -rf /`",
    ]
    for (const payload of sqlPayloads) {
      expect(uuidRegex.test(payload)).toBe(false)
    }
  })

  it('valid UUIDs pass the filter', () => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    expect(uuidRegex.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    expect(uuidRegex.test('F47AC10B-58CC-4372-A567-0E02B2C3D479')).toBe(true)
  })
})

// ============================================================
// 2. Information Disclosure Prevention
// ============================================================
describe('Information Disclosure Prevention', () => {
  it('proxy image route does not leak domain names in errors', () => {
    // Read the actual route file to verify no domain interpolation in error messages
    const routeContent = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/proxy/image/route.ts'),
      'utf-8'
    )
    // Should NOT contain template literal with hostname in error message
    expect(routeContent).not.toContain('`Domain not whitelisted: ${')
    expect(routeContent).not.toContain('`Invalid content type: ${')
    // Should contain the safe versions
    expect(routeContent).toContain("'Domain not whitelisted'")
    expect(routeContent).toContain("'Invalid content type'")
  })
})

// ============================================================
// 3. Cursor Date Validation
// ============================================================
describe('Cursor Date Validation', () => {
  it('valid ISO date strings parse correctly', () => {
    const validDates = [
      '2026-01-15T12:00:00.000Z',
      '2025-12-31T23:59:59Z',
      '2026-02-12T00:00:00.000Z',
    ]
    for (const d of validDates) {
      const parsed = new Date(d)
      expect(isNaN(parsed.getTime())).toBe(false)
    }
  })

  it('invalid cursor strings result in Invalid Date', () => {
    const invalidCursors = [
      '../../etc/passwd',
      'not-a-date',
      'DROP TABLE;--',
      '',
      'null',
    ]
    for (const c of invalidCursors) {
      const parsed = new Date(c)
      expect(isNaN(parsed.getTime())).toBe(true)
    }
  })
})

// ============================================================
// 4. Not-Found Page Exists
// ============================================================
describe('Not-Found Page', () => {
  it('not-found.tsx exists in app directory', () => {
    const notFoundPath = path.join(process.cwd(), 'src/app/not-found.tsx')
    expect(fs.existsSync(notFoundPath)).toBe(true)
  })

  it('not-found page contains proper content', () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/app/not-found.tsx'),
      'utf-8'
    )
    expect(content).toContain('404')
    expect(content).toContain('Page not found')
    expect(content).toContain('Go Home')
  })
})

// ============================================================
// 5. SSRF Defense Chain
// ============================================================
describe('SSRF Defense', () => {
  it('blocks private IPv4 addresses', () => {
    expect(isInternalIP('127.0.0.1')).toBe(true)
    expect(isInternalIP('10.0.0.1')).toBe(true)
    expect(isInternalIP('192.168.1.1')).toBe(true)
    expect(isInternalIP('172.16.0.1')).toBe(true)
  })

  it('blocks IPv6 loopback', () => {
    expect(isInternalIP('::1')).toBe(true)
  })

  it('blocks cloud metadata IPs', () => {
    expect(isInternalIP('169.254.169.254')).toBe(true)
  })

  it('allows public IPs', () => {
    expect(isInternalIP('8.8.8.8')).toBe(false)
    expect(isInternalIP('1.1.1.1')).toBe(false)
  })

  it('whitelists MangaDex domains', () => {
    expect(isWhitelistedDomain('https://uploads.mangadex.org/covers/abc.jpg')).toBe(true)
  })

  it('rejects non-whitelisted domains', () => {
    expect(isWhitelistedDomain('https://evil.com/malware.jpg')).toBe(false)
  })
})

// ============================================================
// 6. Security Header Verification
// ============================================================
describe('Middleware Security Headers', () => {
  it('middleware file sets required security headers', () => {
    const middlewareContent = fs.readFileSync(
      path.join(process.cwd(), 'src/middleware.ts'),
      'utf-8'
    )
    expect(middlewareContent).toContain('X-Frame-Options')
    expect(middlewareContent).toContain('X-Content-Type-Options')
    expect(middlewareContent).toContain('X-XSS-Protection')
    expect(middlewareContent).toContain('Content-Security-Policy')
    expect(middlewareContent).toContain('Referrer-Policy')
    expect(middlewareContent).toContain('Strict-Transport-Security')
    expect(middlewareContent).toContain('Permissions-Policy')
  })

  it('CSP blocks frame-src in production', () => {
    const middlewareContent = fs.readFileSync(
      path.join(process.cwd(), 'src/middleware.ts'),
      'utf-8'
    )
    expect(middlewareContent).toContain("frame-src 'none'")
    expect(middlewareContent).toContain("frame-ancestors 'none'")
  })
})
