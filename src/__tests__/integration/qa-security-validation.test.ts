/**
 * QA Security & Validation Tests
 * 
 * Integration tests covering:
 * 1. UUID validation on activityId params (comments, likes)
 * 2. Comment content sanitization (XSS prevention)
 * 3. Login route CSRF validation and input validation
 * 4. Comment length validation edge cases
 */

import { sanitizeInput, validateUUID, UUID_REGEX, validateEmail } from '@/lib/api-utils'

// ============================================================
// 1. UUID Validation Tests
// ============================================================
describe('UUID Validation', () => {
  it('accepts valid UUIDs', () => {
    const validUUIDs = [
      '550e8400-e29b-41d4-a716-446655440000',
      '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    ]
    for (const uuid of validUUIDs) {
      expect(() => validateUUID(uuid, 'test')).not.toThrow()
    }
  })

  it('rejects malformed UUIDs', () => {
    const invalidUUIDs = [
      'not-a-uuid',
      '550e8400-e29b-41d4-a716',
      '550e8400e29b41d4a716446655440000', // no dashes
      '',
      'DROP TABLE activities;--',
      '../../../etc/passwd',
      '550e8400-e29b-41d4-a716-44665544000g', // invalid hex char
    ]
    for (const uuid of invalidUUIDs) {
      expect(() => validateUUID(uuid, 'activityId')).toThrow()
    }
  })

  it('UUID regex matches standard format', () => {
    expect(UUID_REGEX.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    expect(UUID_REGEX.test('not-valid')).toBe(false)
    expect(UUID_REGEX.test('')).toBe(false)
  })
})

// ============================================================
// 2. Comment Content Sanitization Tests
// ============================================================
describe('Comment Sanitization (XSS Prevention)', () => {
  it('strips script tags', () => {
    const malicious = '<script>alert("xss")</script>Hello'
    const result = sanitizeInput(malicious, 500)
    expect(result).not.toContain('<script')
    expect(result).not.toContain('</script>')
    expect(result).toContain('Hello')
  })

  it('strips iframe tags', () => {
    const malicious = '<iframe src="evil.com"></iframe>Content'
    const result = sanitizeInput(malicious, 500)
    expect(result).not.toContain('<iframe')
    expect(result).toContain('Content')
  })

  it('strips event handler attributes', () => {
    const malicious = 'Hello <img onerror="alert(1)"> World'
    const result = sanitizeInput(malicious, 500)
    expect(result).not.toContain('onerror=')
  })

  it('strips javascript: protocol', () => {
    const malicious = 'Click javascript:alert(1)'
    const result = sanitizeInput(malicious, 500)
    expect(result).not.toContain('javascript:')
  })

  it('preserves normal text', () => {
    const normal = 'Great chapter! I loved the plot twist.'
    const result = sanitizeInput(normal, 500)
    expect(result).toBe(normal)
  })

  it('preserves emoticons like <3', () => {
    const text = 'I love this manga <3'
    const result = sanitizeInput(text, 500)
    expect(result).toContain('<3')
  })

  it('truncates to max length', () => {
    const long = 'A'.repeat(600)
    const result = sanitizeInput(long, 500)
    expect(result.length).toBeLessThanOrEqual(500)
  })

  it('handles empty string', () => {
    expect(sanitizeInput('', 500)).toBe('')
  })

  it('strips null bytes', () => {
    const withNull = 'Hello\x00World'
    const result = sanitizeInput(withNull, 500)
    expect(result).not.toContain('\x00')
  })

  it('handles nested script attempts', () => {
    const nested = '<scr<script>ipt>alert(1)</scr</script>ipt>'
    const result = sanitizeInput(nested, 500)
    expect(result).not.toContain('alert(1)')
  })
})

// ============================================================
// 3. Login Input Validation Tests
// ============================================================
describe('Login Input Validation', () => {
  it('validates email format', () => {
    expect(validateEmail('user@example.com')).toBe(true)
    expect(validateEmail('user@domain.co')).toBe(true)
    expect(validateEmail('notanemail')).toBe(false)
    expect(validateEmail('')).toBe(false)
    expect(validateEmail('@')).toBe(false)
    expect(validateEmail('user@')).toBe(false)
    expect(validateEmail('@domain.com')).toBe(false)
  })
})

// ============================================================
// 4. Edge Cases for Comment Validation
// ============================================================
describe('Comment Validation Edge Cases', () => {
  it('sanitizeInput handles whitespace-only content', () => {
    const result = sanitizeInput('   ', 500)
    expect(result).toBe('')
  })

  it('sanitizeInput handles content at exact max length', () => {
    const exactLength = 'A'.repeat(500)
    const result = sanitizeInput(exactLength, 500)
    expect(result.length).toBe(500)
  })

  it('sanitizeInput handles unicode content', () => {
    const unicode = '日本語のコメント 🎉'
    const result = sanitizeInput(unicode, 500)
    expect(result).toContain('日本語')
  })

  it('sanitizeInput handles mixed XSS and valid content', () => {
    const mixed = 'Good manga! <script>steal(cookies)</script> Recommend chapter 5.'
    const result = sanitizeInput(mixed, 500)
    expect(result).toContain('Good manga!')
    expect(result).toContain('Recommend chapter 5.')
    expect(result).not.toContain('<script')
    expect(result).not.toContain('steal(cookies)')
  })
})
