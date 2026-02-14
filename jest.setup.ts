import '@testing-library/jest-dom'
import { config } from 'dotenv'
import { randomUUID } from 'crypto'

config()

// Polyfill crypto.randomUUID for Jest environment
if (typeof global.crypto === 'undefined') {
  Object.defineProperty(global, 'crypto', {
    value: { randomUUID },
  })
} else if (typeof global.crypto.randomUUID === 'undefined') {
  Object.defineProperty(global.crypto, 'randomUUID', {
    value: randomUUID,
  })
}

// Polyfill for NextRequest/NextResponse in Jest environment
// NextRequest relies on Web API Headers which jsdom doesn't fully support
class MockHeaders implements Headers {
  private _headers: Map<string, string> = new Map()

  constructor(init?: HeadersInit) {
    if (init) {
      if (init instanceof MockHeaders || init instanceof Headers) {
        init.forEach((value, key) => this._headers.set(key.toLowerCase(), value))
      } else if (Array.isArray(init)) {
        init.forEach(([key, value]) => this._headers.set(key.toLowerCase(), value))
      } else if (typeof init === 'object') {
        Object.entries(init).forEach(([key, value]) => this._headers.set(key.toLowerCase(), value))
      }
    }
  }

  append(name: string, value: string): void {
    const key = name.toLowerCase()
    const existing = this._headers.get(key)
    this._headers.set(key, existing ? `${existing}, ${value}` : value)
  }

  delete(name: string): void {
    this._headers.delete(name.toLowerCase())
  }

  get(name: string): string | null {
    return this._headers.get(name.toLowerCase()) ?? null
  }

  has(name: string): boolean {
    return this._headers.has(name.toLowerCase())
  }

  set(name: string, value: string): void {
    this._headers.set(name.toLowerCase(), value)
  }

  forEach(callbackfn: (value: string, key: string, parent: Headers) => void): void {
    this._headers.forEach((value, key) => callbackfn(value, key, this))
  }

  entries(): HeadersIterator<[string, string]> {
    return this._headers.entries() as HeadersIterator<[string, string]>
  }

  keys(): HeadersIterator<string> {
    return this._headers.keys() as HeadersIterator<string>
  }

  values(): HeadersIterator<string> {
    return this._headers.values() as HeadersIterator<string>
  }

  [Symbol.iterator](): HeadersIterator<[string, string]> {
    return this._headers.entries() as HeadersIterator<[string, string]>
  }

  getSetCookie(): string[] {
    const cookie = this._headers.get('set-cookie')
    return cookie ? [cookie] : []
  }
}

// Mock NextRequest class that works in Jest
class MockNextRequest {
  public url: string
  public method: string
  public headers: MockHeaders
  public nextUrl: URL
  private _body: string | null = null

  constructor(input: string | URL, init?: RequestInit) {
    this.url = typeof input === 'string' ? input : input.toString()
    this.method = init?.method || 'GET'
    this.headers = new MockHeaders(init?.headers)
    this.nextUrl = new URL(this.url)
    if (init?.body) {
      this._body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body)
    }
  }

  async json(): Promise<unknown> {
    if (this._body) {
      return JSON.parse(this._body)
    }
    return {}
  }

  async text(): Promise<string> {
    return this._body || ''
  }

  clone(): MockNextRequest {
    return new MockNextRequest(this.url, {
      method: this.method,
      headers: this.headers as unknown as HeadersInit,
      body: this._body || undefined,
    })
  }

  get cookies() {
    return {
      get: (name: string) => {
        const cookieHeader = this.headers.get('cookie')
        if (!cookieHeader) return undefined
        const match = cookieHeader.match(new RegExp(`${name}=([^;]+)`))
        return match ? { name, value: match[1] } : undefined
      },
      getAll: () => [],
      has: () => false,
      set: () => {},
      delete: () => {},
    }
  }

  get geo() {
    return {}
  }

  get ip() {
    return this.headers.get('x-forwarded-for') || '127.0.0.1'
  }
}

// Mock NextResponse class
class MockNextResponse {
  public status: number
  public headers: MockHeaders
  private _body: unknown

  constructor(body?: BodyInit | null, init?: ResponseInit) {
    this._body = body
    this.status = init?.status || 200
    this.headers = new MockHeaders(init?.headers)
  }

  async json(): Promise<unknown> {
    if (typeof this._body === 'string') {
      return JSON.parse(this._body)
    }
    return this._body
  }

  async text(): Promise<string> {
    if (typeof this._body === 'string') {
      return this._body
    }
    return JSON.stringify(this._body)
  }

  static json(data: unknown, init?: ResponseInit): MockNextResponse {
    const response = new MockNextResponse(JSON.stringify(data), init)
    response.headers.set('content-type', 'application/json')
    return response
  }

  static redirect(url: string | URL, status = 307): MockNextResponse {
    const response = new MockNextResponse(null, { status })
    response.headers.set('location', typeof url === 'string' ? url : url.toString())
    return response
  }

  static next(): MockNextResponse {
    return new MockNextResponse(null, { status: 200 })
  }
}

// Override the global NextRequest/NextResponse with mocks
jest.mock('next/server', () => ({
  NextRequest: MockNextRequest,
  NextResponse: MockNextResponse,
}))

type MockFn = jest.Mock

interface MockPrismaModel {
  findUnique: MockFn
  findFirst: MockFn
  findMany: MockFn
  create: MockFn
  createMany: MockFn
  createManyAndReturn: MockFn
  update: MockFn
  updateMany: MockFn
  upsert: MockFn
  delete: MockFn
  deleteMany: MockFn
  count: MockFn
  aggregate: MockFn
  groupBy: MockFn
}

const createMockPrismaModel = (defaults: Partial<MockPrismaModel> = {}): MockPrismaModel => ({
  findUnique: jest.fn().mockImplementation((args: { where?: { id?: string } }) => Promise.resolve(args?.where?.id ? { id: args.where.id, xp: 0, level: 1, season_xp: 0, chapters_read: 0, streak_days: 0, longest_streak: 0, username: 'mock_user', email: 'mock@test.com', created_at: new Date(), updated_at: new Date() } : null)),
  findFirst: jest.fn().mockResolvedValue(null),
  findMany: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockImplementation((args: { data?: Record<string, unknown> }) => Promise.resolve({ id: randomUUID(), ...args?.data })),
  createMany: jest.fn().mockResolvedValue({ count: 0 }),
  createManyAndReturn: jest.fn().mockResolvedValue([]),
  update: jest.fn().mockImplementation((args: { where?: { id?: string }; data?: Record<string, unknown> }) => Promise.resolve({ id: args?.where?.id, ...args?.data })),
  updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  upsert: jest.fn().mockImplementation((args: { create?: Record<string, unknown> }) => Promise.resolve({ id: randomUUID(), ...args?.create })),
  delete: jest.fn().mockResolvedValue({}),
  deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  count: jest.fn().mockResolvedValue(0),
  aggregate: jest.fn().mockResolvedValue({}),
  groupBy: jest.fn().mockResolvedValue([]),
  ...defaults,
})

const SOFT_DELETE_MODELS = ['User', 'Series', 'Chapter', 'LibraryEntry']

const buildSoftDeleteSafeQuery = (baseQuery: string, tableName: string): string => {
  const isSoftDeleteModel = SOFT_DELETE_MODELS.some(
    model => tableName.toLowerCase().includes(model.toLowerCase())
  )
  
  if (!isSoftDeleteModel) {
    return baseQuery
  }
  
  const upperQuery = baseQuery.toUpperCase()
  const hasWhere = upperQuery.includes('WHERE')
  const hasDeletedAtFilter = baseQuery.toLowerCase().includes('deleted_at')
  
  if (hasDeletedAtFilter) {
    return baseQuery
  }
  
  if (hasWhere) {
    const whereIndex = upperQuery.indexOf('WHERE')
    const afterWhere = whereIndex + 6
    return `${baseQuery.slice(0, afterWhere)} ${tableName}.deleted_at IS NULL AND ${baseQuery.slice(afterWhere)}`
  } else {
    const orderByIndex = upperQuery.indexOf('ORDER BY')
    const limitIndex = upperQuery.indexOf('LIMIT')
    const groupByIndex = upperQuery.indexOf('GROUP BY')
    
    const insertPoint = Math.min(
      orderByIndex > -1 ? orderByIndex : baseQuery.length,
      limitIndex > -1 ? limitIndex : baseQuery.length,
      groupByIndex > -1 ? groupByIndex : baseQuery.length
    )
    
    return `${baseQuery.slice(0, insertPoint)} WHERE ${tableName}.deleted_at IS NULL ${baseQuery.slice(insertPoint)}`
  }
}

// All prisma model names used across the codebase
const PRISMA_MODELS = [
  'workerFailure', 'auditLog', 'series', 'user', 'chapter',
  'chapterSource', 'seriesSource', 'legacyChapter', 'feedEntry',
  'libraryEntry', 'notification', 'queryStats', 'userChapterReadV2',
  'follow', 'readingStreak', 'seasonalXp', 'achievement',
  'userAchievement', 'userSourcePriority', 'userContentFilter',
  'seasonalUserAchievement', 'season', 'logicalChapter',
  'notificationQueue', 'activity', 'chapterLink', 'dmcaRequest',
  'importItem', 'importJob', 'linkSubmissionAudit',
  'mangaUpdatesRelease', 'queryStat',
  // PascalCase aliases (Prisma allows both)
  'SeriesSource', 'ChapterSource', 'LibraryEntry', 'Series',
  'User', 'Chapter', 'FeedEntry', 'Achievement', 'UserAchievement',
  'Season', 'SeasonalXp', 'ReadingStreak', 'Activity', 'Follow',
  'Notification', 'NotificationQueue', 'AuditLog', 'WorkerFailure',
  'UserChapterReadV2', 'LogicalChapter', 'ChapterLink', 'DmcaRequest',
  'ImportItem', 'ImportJob', 'LinkSubmissionAudit', 'MangaUpdatesRelease',
  'QueryStat', 'UserSourcePriority', 'UserContentFilter',
  'SeasonalUserAchievement', 'LegacyChapter',
] as const

function createMockPrismaClient() {
  const client: Record<string, unknown> = {
    $transaction: jest.fn((fn: unknown) => {
      if (typeof fn === 'function') {
        const txClient: Record<string, unknown> = {
          $executeRaw: jest.fn().mockResolvedValue(0),
          $executeRawUnsafe: jest.fn().mockResolvedValue(0),
          $queryRaw: jest.fn().mockResolvedValue([]),
          $queryRawUnsafe: jest.fn().mockResolvedValue([]),
        }
        for (const model of PRISMA_MODELS) {
          txClient[model] = createMockPrismaModel()
        }
        return fn(txClient)
      }
      return Promise.all(fn as Promise<unknown>[])
    }),
    $executeRaw: jest.fn().mockResolvedValue(0),
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    $queryRaw: jest.fn().mockResolvedValue([]),
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $connect: jest.fn().mockResolvedValue(undefined),
    $extends: jest.fn().mockReturnThis(),
  }
  for (const model of PRISMA_MODELS) {
    client[model] = createMockPrismaModel()
  }
  return client
}

const mockPrisma = createMockPrismaClient()
const mockPrismaRead = createMockPrismaClient()

// Inline isTransientError to avoid jest.requireActual which triggers real PrismaClient initialization
function mockIsTransientError(error: unknown): boolean {
    if (!error) return false
    const e = error as { message?: string; code?: string; name?: string; constructor?: { name?: string } }
    const msg = (e.message || '').toLowerCase()
    const code = e.code || ''
    const eName = e.constructor?.name || (e.name !== 'Error' ? e.name : '') || ''
    const nonTransient = ['password authentication failed','authentication failed','access denied','permission denied','invalid credentials']
    if (nonTransient.some(p => msg.includes(p))) return false
    if (['P1000','P1003'].includes(code)) return false
    const transient = ['circuit breaker',"can't reach database",'connection refused','connection reset','connection timed out','econnrefused','econnreset','etimedout','unable to establish connection','connection pool timeout','too many connections','pool_timeout','server closed the connection unexpectedly','prepared statement','ssl connection has been closed unexpectedly','connection closed','socket hang up']
    const transientCodes = ['P1001','P1002','P1008','P1017','P2024','P2028','40001','40P01','57P01']
    const isInit = eName.includes('PrismaClientInitializationError') || eName.includes('PrismaClientKnownRequestError') || (msg.includes('prisma') && (msg.includes('initialization') || msg.includes('invocation')))
    return isInit || transient.some(p => msg.includes(p)) || transientCodes.includes(code)
  }

  jest.mock('@/lib/prisma', () => ({
      prisma: mockPrisma,
      prismaRead: mockPrismaRead,
      withRetry: jest.fn((fn: () => Promise<unknown>) => fn()),
      isTransientError: mockIsTransientError,
      buildSoftDeleteSafeQuery: buildSoftDeleteSafeQuery,
      rawQueryWithSoftDeleteWarning: jest.fn((query: string) => query),
      executeRawWithSoftDelete: jest.fn().mockResolvedValue([]),
      safeQuery: jest.fn((fn: () => Promise<unknown>) => fn()),
      checkDatabaseHealth: jest.fn().mockResolvedValue({ healthy: true, latencyMs: 1 }),
      waitForDatabase: jest.fn().mockResolvedValue(true),
      hasReadReplica: false,
      DEFAULT_TRANSACTION_TIMEOUT: 15000,
      LONG_TRANSACTION_TIMEOUT: 45000,
      DEFAULT_TX_OPTIONS: { timeout: 15000 },
      LONG_TX_OPTIONS: { timeout: 45000 },
      createTxOptions: jest.fn((timeout: number) => ({ timeout })),
      TransactionClient: {},
  }))

// Global mock for @/lib/redis
// Stateful Redis counter for rate limiting tests
const redisCounters = new Map<string, number>()
const redisTTLs = new Map<string, number>()

const createMultiChain = (): Record<string, jest.Mock> => {
  const commands: Array<{ cmd: string; args: unknown[] }> = []
  const chain: Record<string, jest.Mock> = {
    incr: jest.fn((key: string) => { commands.push({ cmd: 'incr', args: [key] }); return chain }),
    pttl: jest.fn((key: string) => { commands.push({ cmd: 'pttl', args: [key] }); return chain }),
    set: jest.fn((...args: unknown[]) => { commands.push({ cmd: 'set', args }); return chain }),
    get: jest.fn((...args: unknown[]) => { commands.push({ cmd: 'get', args }); return chain }),
    del: jest.fn((...args: unknown[]) => { commands.push({ cmd: 'del', args }); return chain }),
    expire: jest.fn((...args: unknown[]) => { commands.push({ cmd: 'expire', args }); return chain }),
    exec: jest.fn().mockImplementation(() => {
      const results = commands.map(({ cmd, args }) => {
        if (cmd === 'incr') {
          const key = args[0] as string
          const current = (redisCounters.get(key) || 0) + 1
          redisCounters.set(key, current)
          return [null, current]
        }
        if (cmd === 'pttl') {
          const key = args[0] as string
          return [null, redisTTLs.get(key) ?? -1]
        }
        return [null, null]
      })
      return Promise.resolve(results)
    }),
  }
  return chain
}

const mockRedisClient = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockImplementation((key: string) => { redisCounters.delete(key); redisTTLs.delete(key); return Promise.resolve(1) }),
    incr: jest.fn().mockImplementation((key: string) => { const v = (redisCounters.get(key) || 0) + 1; redisCounters.set(key, v); return Promise.resolve(v) }),
    decr: jest.fn().mockResolvedValue(0),
    expire: jest.fn().mockResolvedValue(1),
    pexpire: jest.fn().mockImplementation((key: string, ms: number) => { redisTTLs.set(key, ms); return Promise.resolve(1) }),
    pttl: jest.fn().mockImplementation((key: string) => Promise.resolve(redisTTLs.get(key) ?? -1)),
    ttl: jest.fn().mockResolvedValue(60),
    exists: jest.fn().mockResolvedValue(0),
    setnx: jest.fn().mockResolvedValue(1),
    mget: jest.fn().mockResolvedValue([]),
    mset: jest.fn().mockResolvedValue('OK'),
    sadd: jest.fn().mockResolvedValue(1),
    srem: jest.fn().mockResolvedValue(1),
    smembers: jest.fn().mockResolvedValue([]),
    sismember: jest.fn().mockResolvedValue(0),
    hget: jest.fn().mockResolvedValue(null),
    hset: jest.fn().mockResolvedValue(1),
    hdel: jest.fn().mockResolvedValue(1),
    hgetall: jest.fn().mockResolvedValue({}),
    zadd: jest.fn().mockResolvedValue(1),
    zrange: jest.fn().mockResolvedValue([]),
    zrangebyscore: jest.fn().mockResolvedValue([]),
    zrem: jest.fn().mockResolvedValue(1),
    lpush: jest.fn().mockResolvedValue(1),
    rpush: jest.fn().mockResolvedValue(1),
    lrange: jest.fn().mockResolvedValue([]),
    llen: jest.fn().mockResolvedValue(0),
    publish: jest.fn().mockResolvedValue(0),
    subscribe: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue('PONG'),
    setex: jest.fn().mockResolvedValue('OK'),
    getex: jest.fn().mockResolvedValue(null),
    ltrim: jest.fn().mockResolvedValue('OK'),
    rpoplpush: jest.fn().mockResolvedValue(null),
    lrem: jest.fn().mockResolvedValue(0),
    lpop: jest.fn().mockResolvedValue(null),
    rpop: jest.fn().mockResolvedValue(null),
    scard: jest.fn().mockResolvedValue(0),
    zcard: jest.fn().mockResolvedValue(0),
    zscore: jest.fn().mockResolvedValue(null),
    zincrby: jest.fn().mockResolvedValue('0'),
    zrangeWithScores: jest.fn().mockResolvedValue([]),
    keys: jest.fn().mockResolvedValue([]),
    scan: jest.fn().mockResolvedValue({ cursor: 0, keys: [] }),
    type: jest.fn().mockResolvedValue('none'),
    quit: jest.fn().mockResolvedValue('OK'),
    disconnect: jest.fn().mockResolvedValue(undefined),
    multi: jest.fn(() => createMultiChain()),
    status: 'ready',
    on: jest.fn(),
  }

jest.mock('@/lib/redis', () => ({
  redis: mockRedisClient,
  redisApi: mockRedisClient,
  redisWorker: mockRedisClient,
  schedulerRedis: mockRedisClient,
  redisApiClient: mockRedisClient,
  redisWorkerClient: mockRedisClient,
  redisConnection: mockRedisClient,
  REDIS_KEY_PREFIX: 'test:',
  buildRedisOptions: jest.fn().mockReturnValue({}),
  getConnectionStats: jest.fn().mockResolvedValue({ api: 'ready', worker: 'ready' }),
  isRedisAvailable: jest.fn().mockReturnValue(true),
  isRedisConnected: jest.fn().mockReturnValue(true),
  waitForRedis: jest.fn().mockResolvedValue(true),
  areWorkersOnline: jest.fn().mockResolvedValue(true),
  setWorkerHeartbeat: jest.fn().mockResolvedValue(undefined),
  withLock: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
  disconnectRedis: jest.fn().mockResolvedValue(undefined),
  redisMode: 'single',
}))

// Global mock for @/lib/supabase/server
const mockSupabaseAuth = {
  getUser: jest.fn().mockResolvedValue({
    data: { user: null },
    error: null,
  }),
  getSession: jest.fn().mockResolvedValue({
    data: { session: null },
    error: null,
  }),
  signInWithPassword: jest.fn().mockResolvedValue({ data: null, error: null }),
  signUp: jest.fn().mockResolvedValue({ data: null, error: null }),
  signOut: jest.fn().mockResolvedValue({ error: null }),
  exchangeCodeForSession: jest.fn().mockResolvedValue({ data: null, error: null }),
}

const mockSupabaseFrom = jest.fn().mockReturnValue({
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  upsert: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  neq: jest.fn().mockReturnThis(),
  gt: jest.fn().mockReturnThis(),
  gte: jest.fn().mockReturnThis(),
  lt: jest.fn().mockReturnThis(),
  lte: jest.fn().mockReturnThis(),
  like: jest.fn().mockReturnThis(),
  ilike: jest.fn().mockReturnThis(),
  in: jest.fn().mockReturnThis(),
  is: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  range: jest.fn().mockReturnThis(),
  single: jest.fn().mockResolvedValue({ data: null, error: null }),
  maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
  then: jest.fn().mockImplementation((resolve: (val: { data: null; error: null }) => void) => resolve({ data: null, error: null })),
})

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: mockSupabaseAuth,
    from: mockSupabaseFrom,
  }),
}))

// Global mock for @/lib/supabase/admin
jest.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        getUserById: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
        listUsers: jest.fn().mockResolvedValue({ data: { users: [] }, error: null }),
        updateUserById: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
        deleteUser: jest.fn().mockResolvedValue({ data: null, error: null }),
      },
      getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
    from: mockSupabaseFrom,
    storage: {
      from: jest.fn().mockReturnValue({
        upload: jest.fn().mockResolvedValue({ data: null, error: null }),
        download: jest.fn().mockResolvedValue({ data: null, error: null }),
        getPublicUrl: jest.fn().mockReturnValue({ data: { publicUrl: '' } }),
        remove: jest.fn().mockResolvedValue({ data: null, error: null }),
        list: jest.fn().mockResolvedValue({ data: [], error: null }),
      }),
    },
  },
}))

// Global mock for @/lib/supabase/cached-user
jest.mock('@/lib/supabase/cached-user', () => ({
  getCachedUser: jest.fn().mockResolvedValue(null),
}))

// Global mock for @/lib/cache-utils
jest.mock('@/lib/cache-utils', () => ({
  invalidateLibraryCache: jest.fn().mockResolvedValue(undefined),
  libraryVersionKey: jest.fn((userId: string) => `test:library-version:${userId}`),
}))

// Global mock for @/lib/logger
jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
  },
}))

// Global mock for @/lib/env
jest.mock('@/lib/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'test-anon-key',
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
  getDatabaseUrl: () => 'postgresql://mock:mock@localhost:5432/mock',
  getRedisUrl: () => 'redis://localhost:6379',
  getInternalApiSecret: () => 'test-internal-secret',
}))

// Global mock for @/lib/cover-resolver
jest.mock('@/lib/cover-resolver', () => ({
  resolveCoverUrl: jest.fn().mockImplementation((_series: unknown, fallback?: string) => fallback || null),
  getCoverUrl: jest.fn().mockReturnValue(null),
  getBestCover: jest.fn().mockResolvedValue(null),
  updateSeriesBestCover: jest.fn().mockResolvedValue(undefined),
  getBestCoversBatch: jest.fn().mockResolvedValue({}),
  updateSeriesBestCoversBatch: jest.fn().mockResolvedValue(undefined),
  isValidCoverUrl: jest.fn().mockReturnValue(true),
}))

// Global mock for @/lib/sql/production-queries - keep real PRODUCTION_QUERIES for tests that inspect SQL
jest.mock('@/lib/sql/production-queries', () => {
  const actual = jest.requireActual('@/lib/sql/production-queries')
  return {
    ...actual,
    getLibraryEntriesOptimized: jest.fn().mockResolvedValue([]),
    getLibraryEntryDetail: jest.fn().mockResolvedValue(null),
    getFeedEntriesOptimized: jest.fn().mockResolvedValue([]),
  }
})

// Global mock for @/lib/scrapers
class MockScraperError extends Error {
  source: string
  retryable: boolean
  isRetryable: boolean
  code: string | undefined
  constructor(message: string, source: string = 'unknown', retryable: boolean = false, code?: string) {
    super(message)
    this.name = 'ScraperError'
    this.source = source
    this.retryable = retryable
    this.isRetryable = retryable
    this.code = code
  }
}
jest.mock('@/lib/scrapers', () => ({
    scrapers: {},
    scrapeSource: jest.fn().mockResolvedValue([]),
    getScraper: jest.fn().mockReturnValue(null),
    getScraperForHost: jest.fn().mockReturnValue(null),
    getSupportedSources: jest.fn().mockReturnValue(['mangadex', 'mangaplus', 'webtoons', 'mangaupdates']),
    validateSourceUrl: jest.fn().mockReturnValue(true),
    ALLOWED_HOSTS: new Set(['mangadex.org', 'api.mangadex.org', 'mangaplus.shueisha.co.jp', 'www.webtoons.com', 'www.mangaupdates.com']),
    ScraperError: MockScraperError,
    DnsError: MockScraperError,
    CircuitBreakerOpenError: MockScraperError,
    RateLimitError: MockScraperError,
    ProxyBlockedError: MockScraperError,
  }))
  jest.mock('@/lib/scrapers/index', () => ({
  scrapeSource: jest.fn().mockResolvedValue([]),
  getScraper: jest.fn().mockReturnValue(null),
  getScraperForHost: jest.fn().mockReturnValue(null),
  getSupportedSources: jest.fn().mockReturnValue(['mangadex', 'mangaplus', 'webtoons', 'mangaupdates']),
  validateSourceUrl: jest.fn().mockReturnValue(true),
  ALLOWED_HOSTS: new Set(['mangadex.org', 'api.mangadex.org', 'mangaplus.shueisha.co.jp', 'www.webtoons.com', 'www.mangaupdates.com']),
  ScraperError: MockScraperError,
}))

// Global mock for @/lib/scraper-errors
jest.mock('@/lib/scraper-errors', () => ({
  ScraperError: MockScraperError,
  DnsError: MockScraperError,
  CircuitBreakerOpenError: MockScraperError,
  RateLimitError: MockScraperError,
  ProxyBlockedError: MockScraperError,
}))

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
} else if (process.env.NODE_ENV === 'test') {
  process.env.DATABASE_URL = 'postgresql://mock:mock@localhost:5432/mock'
}
if (process.env.TEST_DIRECT_URL) {
  process.env.DIRECT_URL = process.env.TEST_DIRECT_URL
}
if (process.env.TEST_SUPABASE_URL) {
  process.env.SUPABASE_URL = process.env.TEST_SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.TEST_SUPABASE_URL
}
if (process.env.TEST_SUPABASE_ANON_KEY) {
  process.env.SUPABASE_ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY
}
if (process.env.TEST_SUPABASE_SERVICE_ROLE_KEY) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY
}

global.fetch = jest.fn()
// Use MockNextRequest as the global Request so that `new Request(...)` works properly
global.Request = MockNextRequest as unknown as typeof Request
global.Response = MockNextResponse as unknown as typeof Response

// Mock next/headers for API route tests
const mockHeadersMap = new Map<string, string>()
jest.mock('next/headers', () => ({
  headers: jest.fn().mockImplementation(() => {
    return Promise.resolve({
      get: (name: string) => mockHeadersMap.get(name.toLowerCase()) ?? null,
      has: (name: string) => mockHeadersMap.has(name.toLowerCase()),
      forEach: (cb: (value: string, key: string) => void) => mockHeadersMap.forEach(cb),
      entries: () => mockHeadersMap.entries(),
      keys: () => mockHeadersMap.keys(),
      values: () => mockHeadersMap.values(),
    })
  }),
  cookies: jest.fn().mockImplementation(() => {
    return Promise.resolve({
      get: jest.fn().mockReturnValue(undefined),
      getAll: jest.fn().mockReturnValue([]),
      has: jest.fn().mockReturnValue(false),
      set: jest.fn(),
      delete: jest.fn(),
    })
  }),
}))

jest.mock('next/navigation', () => ({
    useRouter: () => ({
      push: jest.fn(),
      replace: jest.fn(),
      refresh: jest.fn(),
      back: jest.fn(),
      forward: jest.fn(),
    }),
    useSearchParams: () => ({
      get: jest.fn(),
    }),
    usePathname: () => '',
  }))

// Clear stateful Redis counters between tests to prevent cross-test pollution
beforeEach(() => {
  redisCounters.clear()
  redisTTLs.clear()
})
