/**
 * Integration Tests for Library API
 * Tests critical library operations with mocked dependencies
 */
import { NextRequest } from 'next/server';

// Mock dependencies
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/prisma', () => {
  const libraryEntry = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  };
  const series = {
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  const user = {
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  const mockPrismaClient = {
    $transaction: jest.fn(),
    libraryEntry,
    series,
    user,
    activity: { findFirst: jest.fn() },
    workerFailure: { create: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  return {
    prisma: mockPrismaClient,
    prismaRead: mockPrismaClient,
    withRetry: jest.fn((fn: () => Promise<unknown>) => fn()),
    isTransientError: jest.fn().mockReturnValue(false),
    DEFAULT_TX_OPTIONS: { timeout: 15000 },
    LONG_TX_OPTIONS: { timeout: 45000 },
    DEFAULT_TRANSACTION_TIMEOUT: 15000,
    LONG_TRANSACTION_TIMEOUT: 45000,
  };
});

jest.mock('@/lib/redis', () => {
  const mockRedis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    pttl: jest.fn().mockResolvedValue(60000),
    pexpire: jest.fn().mockResolvedValue(1),
    multi: jest.fn(() => ({
      incr: jest.fn().mockReturnThis(),
      pttl: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 1], [null, 60000]]),
    })),
  };
  return {
    redis: mockRedis,
    redisApi: mockRedis,
    waitForRedis: jest.fn().mockResolvedValue(true),
    REDIS_KEY_PREFIX: 'test:',
  };
});

jest.mock('@/lib/catalog-tiers', () => ({
  promoteSeriesTier: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/gamification/achievements', () => ({
  checkAchievements: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/lib/bug-fixes/v5-audit-bugs-51-80', () => ({
  assertUserExistsInTransaction: jest.fn().mockResolvedValue({ valid: true }),
  verifyOwnershipInTransaction: jest.fn().mockResolvedValue({ valid: true }),
  validateLibraryEntryOwnership: jest.fn().mockResolvedValue({ valid: true }),
}));

jest.mock('@/lib/gamification/activity', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/gamification/xp', () => ({
  XP_SERIES_COMPLETED: 50,
  calculateLevel: jest.fn().mockReturnValue({ level: 1, currentXp: 0, xpForNextLevel: 100 }),
}));

jest.mock('@/lib/analytics/signals', () => ({
  recordSignal: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/anti-abuse', () => ({
  antiAbuse: {
    checkAddToLibraryAbuse: jest.fn().mockResolvedValue({ blocked: false }),
    checkStatusRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
    detectStatusBotPatterns: jest.fn().mockResolvedValue({ isBot: false }),
    canGrantXp: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('@/lib/job-cleanup', () => ({
  cancelJobsForLibraryEntry: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/idempotency', () => ({
  checkIdempotency: jest.fn().mockResolvedValue({ isDuplicate: false }),
  storeIdempotencyResult: jest.fn().mockResolvedValue(undefined),
  extractIdempotencyKey: jest.fn().mockReturnValue(null),
}));

jest.mock('@prisma/client', () => ({
  Prisma: {
    sql: jest.fn(),
    join: jest.fn(),
    raw: jest.fn(),
    PrismaClientKnownRequestError: class extends Error { code: string; constructor(m: string, opts: { code: string }) { super(m); this.code = opts.code; } },
  },
}));

import { createClient } from '@/lib/supabase/server';
import { prisma, prismaRead } from '@/lib/prisma';
import { GET, POST } from '@/app/api/library/route';
import { PATCH, DELETE } from '@/app/api/library/[id]/route';

describe('Library API Integration Tests', () => {
  const mockUser = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    email: 'test@example.com',
  };

  const mockSeries = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    title: 'Test Manga',
    SeriesSource: [{
      id: 'source-123',
      source_name: 'mangadex',
      source_url: 'https://mangadex.org/title/test',
      trust_score: 100,
    }],
  };

  const mockLibraryEntry = {
    id: 'entry-123',
    user_id: mockUser.id,
    series_id: mockSeries.id,
    status: 'reading',
    source_url: 'https://mangadex.org/title/test',
    last_read_chapter: 5,
    user_rating: null,
    updated_at: new Date(),
    series: {
      id: mockSeries.id,
      title: 'Test Manga',
      cover_url: 'https://example.com/cover.jpg',
      type: 'manga',
      status: 'ongoing',
      content_rating: 'safe',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default authenticated user mock
    (createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: mockUser },
          error: null,
        }),
      },
    });
  });

  describe('GET /api/library', () => {
    it('should return library entries for authenticated user', async () => {
        const mockEntries = [mockLibraryEntry];
        const mockStatusCounts = [
          { status: 'reading', _count: 5 },
          { status: 'completed', _count: 3 },
        ];

        (prismaRead.libraryEntry.findMany as jest.Mock).mockResolvedValue(mockEntries);
        (prismaRead.libraryEntry.count as jest.Mock).mockResolvedValue(5);
        (prismaRead.libraryEntry.groupBy as jest.Mock).mockResolvedValue(mockStatusCounts);

        const request = new NextRequest('http://localhost/api/library');
        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.entries).toHaveLength(1);
        expect(data.stats.reading).toBe(5);
        expect(data.pagination.total).toBe(5);
      });

    it('should return 401 for unauthenticated requests', async () => {
      (createClient as jest.Mock).mockResolvedValue({
        auth: {
          getUser: jest.fn().mockResolvedValue({
            data: { user: null },
            error: null,
          }),
        },
      });

      const request = new NextRequest('http://localhost/api/library');
      const response = await GET(request);
      
      expect(response.status).toBe(401);
    });

    it('should filter by status when provided', async () => {
        (prismaRead.libraryEntry.findMany as jest.Mock).mockResolvedValue([mockLibraryEntry]);
        (prismaRead.libraryEntry.count as jest.Mock).mockResolvedValue(1);
        (prismaRead.libraryEntry.groupBy as jest.Mock).mockResolvedValue([{ status: 'reading', _count: 1 }]);

        const request = new NextRequest('http://localhost/api/library?status=reading');
        const response = await GET(request);

        expect(response.status).toBe(200);
      });

      it('should search by title when q parameter provided', async () => {
        (prismaRead.libraryEntry.findMany as jest.Mock).mockResolvedValue([mockLibraryEntry]);
        (prismaRead.libraryEntry.count as jest.Mock).mockResolvedValue(1);
        (prismaRead.libraryEntry.groupBy as jest.Mock).mockResolvedValue([{ status: 'reading', _count: 1 }]);

        const request = new NextRequest('http://localhost/api/library?q=manga');
        const response = await GET(request);

        expect(response.status).toBe(200);
      });
  });

  describe('POST /api/library', () => {
    beforeEach(() => {
      (prisma.series.findUnique as jest.Mock).mockResolvedValue(mockSeries);
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        const tx = {
          libraryEntry: {
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue(mockLibraryEntry),
          },
          series: {
            update: jest.fn().mockResolvedValue(mockSeries),
          },
        };
        return fn(tx);
      });
      (prisma.auditLog.create as jest.Mock).mockResolvedValue({});
    });

    it('should add series to library', async () => {
      const request = new NextRequest('http://localhost/api/library', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost',
          'Host': 'localhost',
        },
        body: JSON.stringify({
          seriesId: mockSeries.id,
          status: 'reading',
        }),
      });

      const response = await POST(request);
      
      expect(response.status).toBe(201);
    });

    it('should return 400 for invalid series ID format', async () => {
      const request = new NextRequest('http://localhost/api/library', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost',
          'Host': 'localhost',
        },
        body: JSON.stringify({
          seriesId: 'not-a-uuid',
          status: 'reading',
        }),
      });

      const response = await POST(request);
      
      expect(response.status).toBe(400);
    });

    it('should return 404 if series does not exist', async () => {
      (prisma.series.findUnique as jest.Mock).mockResolvedValue(null);

      const request = new NextRequest('http://localhost/api/library', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost',
          'Host': 'localhost',
        },
        body: JSON.stringify({
          seriesId: '550e8400-e29b-41d4-a716-446655440000',
          status: 'reading',
        }),
      });

      const response = await POST(request);
      
      expect(response.status).toBe(404);
    });

    it('should return 400 for invalid status', async () => {
      const request = new NextRequest('http://localhost/api/library', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost',
          'Host': 'localhost',
        },
        body: JSON.stringify({
          seriesId: mockSeries.id,
          status: 'invalid_status',
        }),
      });

      const response = await POST(request);
      
      expect(response.status).toBe(400);
    });
  });

  describe('PATCH /api/library/[id]', () => {
      beforeEach(() => {
        (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
          const tx = {
            $queryRaw: jest.fn().mockResolvedValue([{ user_id: mockUser.id }]),
            $executeRaw: jest.fn().mockResolvedValue(0),
            libraryEntry: {
              findUnique: jest.fn().mockResolvedValue(mockLibraryEntry),
              update: jest.fn().mockResolvedValue({ ...mockLibraryEntry, status: 'completed' }),
            },
            user: {
              findUnique: jest.fn().mockResolvedValue({ id: mockUser.id, xp: 100 }),
              update: jest.fn().mockResolvedValue({}),
            },
            activity: {
              findFirst: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockResolvedValue({}),
            },
            seasonalXp: {
              upsert: jest.fn().mockResolvedValue({}),
            },
            readingStreak: {
              findFirst: jest.fn().mockResolvedValue(null),
              upsert: jest.fn().mockResolvedValue({}),
            },
            userChapterReadV2: {
              findFirst: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockResolvedValue({}),
            },
          };
          return fn(tx);
        });
      });

      it('should update library entry status', async () => {
        const request = new NextRequest('http://localhost/api/library/550e8400-e29b-41d4-a716-446655440000', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Origin': 'http://localhost',
            'Host': 'localhost',
          },
          body: JSON.stringify({
            status: 'completed',
          }),
        });

        const params = Promise.resolve({ id: '550e8400-e29b-41d4-a716-446655440000' });
      const response = await PATCH(request, { params });
      
      expect(response.status).toBe(200);
    });

      it('should validate rating range', async () => {
        const request = new NextRequest('http://localhost/api/library/550e8400-e29b-41d4-a716-446655440000', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost',
          'Host': 'localhost',
        },
        body: JSON.stringify({
          rating: 15, // Invalid: should be 1-10
        }),
      });

      const params = Promise.resolve({ id: '550e8400-e29b-41d4-a716-446655440000' });
      const response = await PATCH(request, { params });
      
      expect(response.status).toBe(400);
    });

      it('should return 404 for non-existent entry', async () => {
        (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
          const tx = {
            $queryRaw: jest.fn().mockResolvedValue([]),
            $executeRaw: jest.fn().mockResolvedValue(0),
            libraryEntry: {
              findUnique: jest.fn().mockResolvedValue(null),
              update: jest.fn(),
            },
            user: {
              findUnique: jest.fn().mockResolvedValue(null),
              update: jest.fn(),
            },
            activity: {
              findFirst: jest.fn().mockResolvedValue(null),
              create: jest.fn(),
            },
            seasonalXp: { upsert: jest.fn() },
            readingStreak: { findFirst: jest.fn(), upsert: jest.fn() },
            userChapterReadV2: { findFirst: jest.fn(), create: jest.fn() },
          };
          return fn(tx);
        });

        const request = new NextRequest('http://localhost/api/library/550e8400-e29b-41d4-a716-446655440000', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Origin': 'http://localhost',
            'Host': 'localhost',
          },
          body: JSON.stringify({
            status: 'completed',
          }),
        });

        const params = Promise.resolve({ id: '550e8400-e29b-41d4-a716-446655440000' });
        const response = await PATCH(request, { params });
        
        expect(response.status).toBe(404);
      });
    });

  describe('DELETE /api/library/[id]', () => {
      beforeEach(() => {
        (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
          const tx = {
            $queryRaw: jest.fn().mockResolvedValue([{ user_id: mockUser.id }]),
            $executeRaw: jest.fn().mockResolvedValue(1),
            libraryEntry: {
              findUnique: jest.fn().mockResolvedValue(mockLibraryEntry),
              update: jest.fn().mockResolvedValue(mockLibraryEntry),
            },
            series: {
              update: jest.fn().mockResolvedValue({}),
            },
          };
          return fn(tx);
        });
      });

      it('should soft-delete library entry', async () => {
        const request = new NextRequest('http://localhost/api/library/550e8400-e29b-41d4-a716-446655440000', {
          method: 'DELETE',
          headers: {
            'Origin': 'http://localhost',
            'Host': 'localhost',
          },
        });

        const params = Promise.resolve({ id: '550e8400-e29b-41d4-a716-446655440000' });
      const response = await DELETE(request, { params });
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

      it('should return 404 for non-existent entry', async () => {
          (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
            const tx = {
              $queryRaw: jest.fn().mockResolvedValue([]),
              $executeRaw: jest.fn().mockResolvedValue(0),
              libraryEntry: {
                findUnique: jest.fn().mockResolvedValue(null),
                update: jest.fn(),
              },
              series: {
                update: jest.fn(),
              },
            };
            return fn(tx);
          });

          const request = new NextRequest('http://localhost/api/library/550e8400-e29b-41d4-a716-446655440001', {
            method: 'DELETE',
            headers: {
              'Origin': 'http://localhost',
              'Host': 'localhost',
            },
          });

          const params = Promise.resolve({ id: '550e8400-e29b-41d4-a716-446655440001' });
        const response = await DELETE(request, { params });
        
        expect(response.status).toBe(404);
      });
    });
  });

describe('Library API Edge Cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-123' } },
          error: null,
        }),
      },
    });
  });

  it('should handle malformed JSON gracefully', async () => {
    const request = new NextRequest('http://localhost/api/library', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost',
        'Host': 'localhost',
      },
      body: 'not valid json',
    });

    const response = await POST(request);
    
    expect(response.status).toBe(400);
  });

  it('should validate UUID format in path parameters', async () => {
    const request = new NextRequest('http://localhost/api/library/not-a-uuid', {
      method: 'DELETE',
      headers: {
        'Origin': 'http://localhost',
        'Host': 'localhost',
      },
    });

    const params = Promise.resolve({ id: 'not-a-uuid' });
    const response = await DELETE(request, { params });
    
    expect(response.status).toBe(400);
  });
});
