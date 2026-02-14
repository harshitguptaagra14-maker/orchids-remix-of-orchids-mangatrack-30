/**
 * Library API Integration Tests
 * Tests library operations, IDOR protection, and access control
 */

import { NextRequest } from 'next/server'

// Mock environment - use Object.defineProperty to avoid readonly error
Object.defineProperty(process.env, 'NODE_ENV', { value: 'test', writable: true })
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

const mockUser = {
  id: 'user-123-456-789',
  email: 'test@example.com',
}

// Mock Supabase
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => ({
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
    },
  })),
}))

jest.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      ilike: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockResolvedValue({ data: [], count: 0, error: null }),
      insert: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  },
}))

// Mock Prisma
jest.mock('@/lib/prisma', () => ({
  prisma: {
    libraryEntry: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    series: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn({
      libraryEntry: {
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: mockUser.id, xp: 100 }),
        update: jest.fn(),
      },
      series: {
        findUnique: jest.fn().mockResolvedValue({ total_follows: 5 }),
        update: jest.fn(),
      },
      activity: {
        create: jest.fn(),
      },
    })),
  },
    prismaRead: {
      libraryEntry: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    },
  withRetry: jest.fn((fn: () => Promise<unknown>) => fn()),
  isTransientError: jest.fn(() => false),
  DEFAULT_TX_OPTIONS: { timeout: 15000 },
}))

// Mock cover resolver
jest.mock('@/lib/cover-resolver', () => ({
  getBestCoversBatch: jest.fn().mockResolvedValue(new Map()),
  selectBestCover: jest.fn(),
  isValidCoverUrl: jest.fn(() => true),
}))

// Mock logger
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

// Mock redis
jest.mock('@/lib/redis', () => ({
  redisApi: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    setex: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    multi: jest.fn(() => ({ incr: jest.fn().mockReturnThis(), expire: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([[null, 1], [null, 1]]) })),
  },
  REDIS_KEY_PREFIX: 'test:',
  withLock: jest.fn((_k: string, _t: number, fn: () => Promise<unknown>) => fn()),
}))

// Mock cache-utils
jest.mock('@/lib/cache-utils', () => ({
  invalidateLibraryCache: jest.fn().mockResolvedValue(undefined),
  libraryVersionKey: jest.fn(() => 'test:lib:v'),
}))

// Mock production queries
jest.mock('@/lib/sql/production-queries', () => ({
  PRODUCTION_QUERIES: {
    getLibraryWithCovers: jest.fn().mockResolvedValue([]),
  },
}))

// Mock catalog tiers
jest.mock('@/lib/catalog-tiers', () => ({
  promoteSeriesTier: jest.fn().mockResolvedValue(undefined),
}))

// Mock utils
jest.mock('@/lib/utils', () => ({
  sanitizePrismaObject: jest.fn((o: unknown) => o),
}))

// Mock gamification
jest.mock('@/lib/gamification/achievements', () => ({
  checkAchievements: jest.fn().mockResolvedValue([]),
  UnlockedAchievement: class {},
}))

jest.mock('@/lib/gamification/activity', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/gamification/xp', () => ({
  XP_SERIES_COMPLETED: 50,
  calculateLevel: jest.fn(() => ({ level: 1, xp: 0, nextLevelXp: 100 })),
}))

// Mock analytics signals
jest.mock('@/lib/analytics/signals', () => ({
  recordSignal: jest.fn().mockResolvedValue(undefined),
}))

// Mock anti-abuse
jest.mock('@/lib/anti-abuse', () => ({
  antiAbuse: {
    checkAndRecord: jest.fn().mockResolvedValue({ allowed: true }),
    checkStatusRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
  },
}))

// Mock job-cleanup
jest.mock('@/lib/job-cleanup', () => ({
  cancelJobsForLibraryEntry: jest.fn().mockResolvedValue(undefined),
}))

// Mock idempotency
jest.mock('@/lib/idempotency', () => ({
  checkIdempotency: jest.fn().mockResolvedValue(null),
  storeIdempotencyResult: jest.fn().mockResolvedValue(undefined),
  extractIdempotencyKey: jest.fn(() => null),
}))

// Mock v5 audit bug fixes
jest.mock('@/lib/bug-fixes/v5-audit-bugs-51-80', () => ({
  assertUserExistsInTransaction: jest.fn().mockResolvedValue({ id: 'user-123-456-789', xp: 100 }),
  verifyOwnershipInTransaction: jest.fn().mockResolvedValue(null),
}))

// Mock @prisma/client
jest.mock('@prisma/client', () => ({
  Prisma: { PrismaClientKnownRequestError: class extends Error { code: string; constructor(m: string, o: { code: string }) { super(m); this.code = o.code } } },
}))

// Mock validateUUID - let it actually validate
jest.mock('@/lib/api-utils', () => {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return {
    sanitizeInput: (i: string) => i,
    checkRateLimit: jest.fn().mockResolvedValue(true),
    clearRateLimit: jest.fn(),
    handleApiError: (e: { statusCode?: number; message?: string }) => {
      const status = e.statusCode || 500
      const body = JSON.stringify({ error: e.message || 'Internal Server Error' })
      return { status, headers: new Map(), json: async () => JSON.parse(body), text: async () => body }
    },
    ApiError: class extends Error {
      statusCode: number
      constructor(m: string, s: number) {
        super(m)
        this.statusCode = s
      }
    },
    ErrorCodes: {
      UNAUTHORIZED: 'UNAUTHORIZED',
      VALIDATION_ERROR: 'VALIDATION_ERROR',
      BAD_REQUEST: 'BAD_REQUEST',
      NOT_FOUND: 'NOT_FOUND',
      CONFLICT: 'CONFLICT',
      RATE_LIMITED: 'RATE_LIMITED',
    },
    validateOrigin: jest.fn(),
    validateUUID: jest.fn((id: string) => {
      if (!UUID_REGEX.test(id)) {
        const err = new Error('Invalid UUID format')
        ;(err as any).statusCode = 400
        throw err
      }
      return true
    }),
    escapeILikePattern: (i: string) => i,
    getClientIp: () => '127.0.0.1',
    logSecurityEvent: jest.fn(),
    validateContentType: jest.fn(),
    validateJsonSize: jest.fn().mockResolvedValue(undefined),
    parsePaginationParams: jest.fn((req: { nextUrl: { searchParams: { get: (k: string) => string | null } } }) => ({
      page: parseInt(req.nextUrl.searchParams.get('page') || '1'),
      limit: parseInt(req.nextUrl.searchParams.get('limit') || '100'),
      offset: parseInt(req.nextUrl.searchParams.get('offset') || '0'),
    })),
    getMiddlewareUser: jest.fn(),
  }
})

// Mock scrapers
jest.mock('@/lib/scrapers/index', () => ({
  validateSourceUrl: jest.fn(() => true),
  getSupportedSources: jest.fn(() => []),
  ALLOWED_HOSTS: new Set(['mangadex.org']),
}))



import { GET as getLibrary } from '@/app/api/library/route'
import { PATCH as updateEntry, DELETE as deleteEntry } from '@/app/api/library/[id]/route'
import { getMiddlewareUser, checkRateLimit } from '@/lib/api-utils'
import { prisma } from '@/lib/prisma'
import { prismaRead } from '@/lib/prisma'
import { checkIdempotency } from '@/lib/idempotency'
import { extractIdempotencyKey } from '@/lib/idempotency'

const mockGetMiddlewareUser = getMiddlewareUser as jest.Mock
const mockCheckRateLimit = checkRateLimit as jest.Mock

describe('Library API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Re-setup mocks cleared by clearAllMocks
    mockGetMiddlewareUser.mockResolvedValue({
      id: mockUser.id,
      email: mockUser.email,
      role: '',
      created_at: '',
      user_metadata: {},
    })
    mockCheckRateLimit.mockResolvedValue(true);
    // Re-setup idempotency mocks
    (checkIdempotency as jest.Mock).mockResolvedValue({ isDuplicate: false, key: null });
    (extractIdempotencyKey as jest.Mock).mockReturnValue(null);
    // Re-setup prismaRead mocks
    (prismaRead.libraryEntry.findMany as jest.Mock).mockResolvedValue([]);
    (prismaRead.libraryEntry.count as jest.Mock).mockResolvedValue(0);
    (prismaRead.libraryEntry.groupBy as jest.Mock).mockResolvedValue([]);
  })

  describe('GET /api/library', () => {
    it('should require authentication', async () => {
      // Override mock to return no user
      mockGetMiddlewareUser.mockResolvedValueOnce(null)
      
      const request = new NextRequest('http://localhost/api/library')
      const response = await getLibrary(request)
      
      expect(response.status).toBe(401)
    })

    it('should validate query parameters', async () => {
      const request = new NextRequest('http://localhost/api/library?limit=999')
      const response = await getLibrary(request)
      
      // Should cap limit at max (200)
      expect(response.status).toBe(200)
    })

    it('should sanitize search query', async () => {
      const maliciousQuery = '<script>alert(1)</script>'
      const request = new NextRequest(`http://localhost/api/library?q=${encodeURIComponent(maliciousQuery)}`)
      const response = await getLibrary(request)
      
      // Should not error, query should be sanitized
      expect(response.status).toBe(200)
    })
  })

  describe('PATCH /api/library/[id]', () => {
    const validUUID = '550e8400-e29b-41d4-a716-446655440000'
    
    it('should require valid UUID format', async () => {
      const request = new NextRequest('http://localhost/api/library/invalid-id', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'reading' }),
      })
      
      const response = await updateEntry(request, { params: Promise.resolve({ id: 'invalid-id' }) })
      
      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('Invalid')
    })

    it('should validate status values', async () => {
      // Setup mock to find entry
      const mockTx = {
        libraryEntry: {
          findUnique: jest.fn().mockResolvedValue({ id: validUUID, user_id: mockUser.id, status: 'reading', series_id: 'series-123' }),
          update: jest.fn().mockResolvedValue({ id: validUUID }),
        },
        user: {
          findUnique: jest.fn().mockResolvedValue({ id: mockUser.id, xp: 100 }),
          update: jest.fn(),
        },
        activity: {
          create: jest.fn(),
        },
      };
      
      (prisma.$transaction as jest.Mock).mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx))

      const request = new NextRequest(`http://localhost/api/library/${validUUID}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'invalid_status' }),
      })
      
      const response = await updateEntry(request, { params: Promise.resolve({ id: validUUID }) })
      
      expect(response.status).toBe(400)
    })

    it('should validate rating range', async () => {
      const mockTx = {
        libraryEntry: {
          findUnique: jest.fn().mockResolvedValue({ id: validUUID, user_id: mockUser.id }),
          update: jest.fn(),
        },
        user: {
          findUnique: jest.fn().mockResolvedValue({ id: mockUser.id, xp: 100 }),
        },
      };
      
      (prisma.$transaction as jest.Mock).mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx))

      const request = new NextRequest(`http://localhost/api/library/${validUUID}`, {
        method: 'PATCH',
        body: JSON.stringify({ rating: 15 }), // Invalid: > 10
      })
      
      const response = await updateEntry(request, { params: Promise.resolve({ id: validUUID }) })
      
      expect(response.status).toBe(400)
    })

    it('should prevent IDOR - accessing other users entries', async () => {
      const mockTx = {
        libraryEntry: {
          findUnique: jest.fn().mockResolvedValue(null), // Entry not found for this user
          update: jest.fn(),
        },
        user: {
          findUnique: jest.fn().mockResolvedValue({ id: mockUser.id, xp: 100 }),
        },
      };
      
      (prisma.$transaction as jest.Mock).mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx))

      const request = new NextRequest(`http://localhost/api/library/${validUUID}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed' }),
      })
      
      const response = await updateEntry(request, { params: Promise.resolve({ id: validUUID }) })
      
      expect(response.status).toBe(404)
    })
  })

  describe('DELETE /api/library/[id]', () => {
    const validUUID = '550e8400-e29b-41d4-a716-446655440000'
    
    it('should require valid UUID format', async () => {
      const request = new NextRequest(`http://localhost/api/library/${validUUID}; DROP TABLE users;`, {
        method: 'DELETE',
      })
      
      const response = await deleteEntry(request, { 
        params: Promise.resolve({ id: `${validUUID}; DROP TABLE users;` }) 
      })
      
      expect(response.status).toBe(400)
    })

    it('should prevent deletion of other users entries', async () => {
        const mockTx = {
          libraryEntry: {
            findUnique: jest.fn().mockResolvedValue(null),
            delete: jest.fn(),
            update: jest.fn(),
          },
          series: {
            findUnique: jest.fn(),
            update: jest.fn(),
          },
          $queryRaw: jest.fn().mockResolvedValue([]), // No rows = not found/not owned
          $executeRaw: jest.fn().mockResolvedValue(0),
        };
        
        (prisma.$transaction as jest.Mock).mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx))

      const request = new NextRequest(`http://localhost/api/library/${validUUID}`, {
        method: 'DELETE',
      })
      
      const response = await deleteEntry(request, { params: Promise.resolve({ id: validUUID }) })
      
      expect(response.status).toBe(404)
    })
  })
})

describe('Library API Rate Limiting', () => {
    beforeEach(() => {
      jest.clearAllMocks()
      mockGetMiddlewareUser.mockResolvedValue({
        id: mockUser.id,
        email: mockUser.email,
        role: '',
        created_at: '',
        user_metadata: {},
      });
      (prismaRead.libraryEntry.findMany as jest.Mock).mockResolvedValue([]);
      (prismaRead.libraryEntry.count as jest.Mock).mockResolvedValue(0);
      (prismaRead.libraryEntry.groupBy as jest.Mock).mockResolvedValue([]);
    })

    it('should enforce rate limits on GET', async () => {
      // Simulate rate limit being hit on 61st request
      mockCheckRateLimit.mockResolvedValue(true)
      
      const request = new NextRequest('http://localhost/api/library')
      const response = await getLibrary(request)
      expect(response.status).toBe(200)

      // Now simulate rate limit exceeded
      mockCheckRateLimit.mockResolvedValue(false)
      const request2 = new NextRequest('http://localhost/api/library')
      const response2 = await getLibrary(request2)
      expect(response2.status).toBe(429)
    })
  })
