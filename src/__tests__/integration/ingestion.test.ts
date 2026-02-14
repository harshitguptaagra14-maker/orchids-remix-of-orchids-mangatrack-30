import { processPollSource } from '@/workers/processors/poll-source.processor';
import { processChapterIngest } from '@/workers/processors/chapter-ingest.processor';
import { prisma } from '@/lib/prisma';
import { chapterIngestQueue, notificationQueue } from '@/lib/queues';
import { scrapers } from '@/lib/scrapers';
import { Prisma } from '@prisma/client';

jest.mock('@/lib/prisma', () => {
  const mp = (overrides: Record<string, any> = {}) => ({
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: '00000000-0000-4000-8000-000000000001' }),
    update: jest.fn().mockResolvedValue({}),
    upsert: jest.fn().mockResolvedValue({ id: '00000000-0000-4000-8000-000000000001' }),
    delete: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    count: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue({}),
    groupBy: jest.fn().mockResolvedValue([]),
    ...overrides,
  });
  const p: any = {
    seriesSource: mp(),
    logicalChapter: mp(),
    chapterSource: mp({ create: jest.fn().mockResolvedValue({ id: 'chapter-source-1' }) }),
    feedEntry: mp(),
    series: mp(),
    legacyChapter: mp(),
    chapter: mp(),
    $transaction: jest.fn((cb: any) => cb(p)),
    $executeRaw: jest.fn().mockResolvedValue(0),
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  return {
    prisma: p,
    withRetry: jest.fn((fn: any) => fn()),
    isTransientError: jest.fn(() => false),
    prismaRead: new Proxy({}, { get: () => mp() }),
  };
});

jest.mock('@/lib/queues', () => ({
  chapterIngestQueue: {
    addBulk: jest.fn(),
    getJobCounts: jest.fn().mockResolvedValue({ waiting: 0 }),
  },
  notificationQueue: {
    add: jest.fn(),
  },
  gapRecoveryQueue: {
    add: jest.fn(),
  },
  feedFanoutQueue: {
    add: jest.fn(),
  },
  getNotificationSystemHealth: jest.fn().mockResolvedValue({ isCritical: false }),
}));

jest.mock('@/lib/scrapers', () => {
  class MockScraperError extends Error { constructor(msg: string) { super(msg); this.name = 'ScraperError'; } }
  class MockRateLimitError extends MockScraperError { constructor(msg: string) { super(msg); this.name = 'RateLimitError'; } }
  class MockProxyBlockedError extends MockScraperError { constructor(msg: string) { super(msg); this.name = 'ProxyBlockedError'; } }
  class MockCircuitBreakerOpenError extends MockScraperError { constructor(msg: string) { super(msg); this.name = 'CircuitBreakerOpenError'; } }
  class MockDnsError extends MockScraperError { constructor(msg: string) { super(msg); this.name = 'DnsError'; } }
  return {
    scrapers: {
      mangadex: {
        scrapeSeries: jest.fn(),
      },
    },
    validateSourceUrl: jest.fn().mockReturnValue(true),
    ScraperError: MockScraperError,
    RateLimitError: MockRateLimitError,
    ProxyBlockedError: MockProxyBlockedError,
    CircuitBreakerOpenError: MockCircuitBreakerOpenError,
    DnsError: MockDnsError,
  };
});

jest.mock('@/lib/rate-limiter', () => ({
  sourceRateLimiter: {
    acquireToken: jest.fn().mockResolvedValue(true),
  },
  negativeResultCache: {
    shouldSkip: jest.fn().mockResolvedValue(false),
    recordResult: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/lib/redis', () => ({
  withLock: jest.fn((_key: string, _ttl: number, cb: () => any) => cb()),
  redisApi: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    setex: jest.fn().mockResolvedValue('OK'),
  },
  REDIS_KEY_PREFIX: 'test:',
}));

jest.mock('@/lib/audit-pass3-fixes', () => ({
  validateJobPayload: jest.fn(() => ({ success: true })),
  createLogContext: jest.fn((ctx: any) => ctx),
  formatStructuredLog: jest.fn((_level: string, msg: string) => msg),
  logStateTransition: jest.fn(),
  classifySyncError: jest.fn(() => ({ category: 'unknown', severity: 'low' })),
  addToDeadLetterQueue: jest.fn(),
  getWorkerRunId: jest.fn(() => 'test-run-id'),
}));

jest.mock('@/lib/notifications-timing', () => ({
  scheduleNotification: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/catalog-tiers', () => ({
  promoteSeriesTier: jest.fn().mockResolvedValue(undefined),
}));

describe('Ingestion Pipeline Integration - Long Source IDs', () => {
  const SERIES_ID = '00000000-0000-0000-0000-000000000001';
  const SOURCE_ID = '00000000-0000-0000-0000-000000000002';
  const LONG_SOURCE_CHAPTER_ID = 'ch_' + 'x'.repeat(3997);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should flow long sourceChapterId from scraper through poll processor to ingest processor', async () => {
    (prisma.seriesSource.findUnique as jest.Mock).mockResolvedValue({
      id: SOURCE_ID,
      series_id: SERIES_ID,
      source_name: 'mangadex',
      source_id: 'manga-uuid',
      source_url: 'https://mangadex.org/title/manga-uuid',
      failure_count: 0,
      Series: { id: SERIES_ID, title: 'Test Manga' },
    });

    (scrapers.mangadex.scrapeSeries as jest.Mock).mockResolvedValue({
      sourceId: 'manga-uuid',
      title: 'Test Manga',
      chapters: [
        {
          chapterNumber: 1.5,
          chapterTitle: 'Special Chapter',
          chapterUrl: 'https://mangadex.org/chapter/long-id-123',
          sourceChapterId: LONG_SOURCE_CHAPTER_ID,
          publishedAt: new Date('2024-01-01T00:00:00Z'),
        },
      ],
    });

    const pollJob = { id: 'poll-job-1', data: { seriesSourceId: SOURCE_ID } } as any;
    await processPollSource(pollJob);

    expect(chapterIngestQueue.addBulk).toHaveBeenCalledWith([
      expect.objectContaining({
        data: expect.objectContaining({
          sourceChapterId: LONG_SOURCE_CHAPTER_ID,
          chapterNumber: 1.5,
        }),
      }),
    ]);

    // Step 2: Ingest Chapter
    const ingestData = (chapterIngestQueue.addBulk as jest.Mock).mock.calls[0][0][0].data;
    const ingestJob = { id: 'ingest-job-1', data: ingestData } as any;

    (prisma.logicalChapter.upsert as jest.Mock).mockResolvedValue({ id: 'logical-ch-1' });
    (prisma.chapterSource.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.logicalChapter.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.feedEntry.findFirst as jest.Mock).mockResolvedValue(null);

    await processChapterIngest(ingestJob);

    expect(prisma.chapterSource.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source_chapter_id: LONG_SOURCE_CHAPTER_ID,
          chapter_id: 'logical-ch-1',
        }),
      })
    );
  });

  it('should correctly handle null sourceChapterId for backward compatibility', async () => {
    (prisma.seriesSource.findUnique as jest.Mock).mockResolvedValue({
      id: SOURCE_ID,
      series_id: SERIES_ID,
      source_name: 'mangadex',
      source_id: 'manga-uuid',
      source_url: 'https://mangadex.org/title/manga-uuid',
      failure_count: 0,
      Series: { id: SERIES_ID, title: 'Test Manga' },
    });

    (scrapers.mangadex.scrapeSeries as jest.Mock).mockResolvedValue({
      sourceId: 'manga-uuid',
      title: 'Test Manga',
      chapters: [
        {
          chapterNumber: 2,
          chapterUrl: 'https://mangadex.org/chapter/short-id',
        },
      ],
    });

    const pollJob = { id: 'poll-job-2', data: { seriesSourceId: SOURCE_ID } } as any;
    await processPollSource(pollJob);

    const ingestData = (chapterIngestQueue.addBulk as jest.Mock).mock.calls[0][0][0].data;
    expect(ingestData.sourceChapterId).toBeNull();

    (prisma.logicalChapter.upsert as jest.Mock).mockResolvedValue({ id: 'logical-ch-2' });
    await processChapterIngest({ id: 'ingest-job-2', data: ingestData } as any);

    expect(prisma.chapterSource.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source_chapter_id: null,
        }),
      })
    );
  });
});
