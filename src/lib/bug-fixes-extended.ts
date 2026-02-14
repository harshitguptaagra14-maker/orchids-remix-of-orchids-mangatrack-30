import { z } from 'zod';
import { TransactionClient } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export const MetadataStatusSchema = z.enum(['pending', 'enriched', 'unavailable', 'failed']);
export type MetadataStatus = z.infer<typeof MetadataStatusSchema>;

export const SyncStatusSchema = z.enum(['healthy', 'degraded', 'failed']);
export type SyncStatus = z.infer<typeof SyncStatusSchema>;

export function isMetadataComplete(entry: {
  metadata_status: MetadataStatus;
  series?: { cover_url?: string | null; title?: string | null } | null;
}): boolean {
  if (entry.metadata_status !== 'enriched') return false;
  if (!entry.series) return false;
  if (!entry.series.title || entry.series.title.trim().length === 0) return false;
  return true;
}

export function hasCoverImage(entry: {
  metadata_status: MetadataStatus;
  series?: { cover_url?: string | null } | null;
}): boolean {
  if (!entry.series?.cover_url) return false;
  try {
    new URL(entry.series.cover_url);
    return true;
  } catch {
    return false;
  }
}

export function getMetadataDisplayState(entry: {
  metadata_status: MetadataStatus;
  sync_status?: SyncStatus;
  needs_review?: boolean;
}): {
  showCover: boolean;
  showPlaceholder: boolean;
  showEnrichingBadge: boolean;
  showUnavailableBadge: boolean;
  showFailedBadge: boolean;
  showSyncWarning: boolean;
  tooltipMessage: string;
} {
  const { metadata_status, sync_status = 'healthy', needs_review = false } = entry;

  switch (metadata_status) {
    case 'enriched':
      return {
        showCover: true,
        showPlaceholder: false,
        showEnrichingBadge: false,
        showUnavailableBadge: false,
        showFailedBadge: false,
        showSyncWarning: sync_status !== 'healthy',
        tooltipMessage: sync_status === 'healthy' 
          ? 'Metadata linked successfully' 
          : `Metadata OK, but sync is ${sync_status}`,
      };

    case 'pending':
      return {
        showCover: false,
        showPlaceholder: true,
        showEnrichingBadge: true,
        showUnavailableBadge: false,
        showFailedBadge: false,
        showSyncWarning: false,
        tooltipMessage: 'Searching for metadata...',
      };

    case 'unavailable':
      return {
        showCover: false,
        showPlaceholder: true,
        showEnrichingBadge: false,
        showUnavailableBadge: true,
        showFailedBadge: false,
        showSyncWarning: false,
        tooltipMessage: needs_review 
          ? 'Metadata not found. Click to manually link.'
          : 'No metadata available on MangaDex. Chapters still sync normally.',
      };

    case 'failed':
      return {
        showCover: false,
        showPlaceholder: true,
        showEnrichingBadge: false,
        showUnavailableBadge: false,
        showFailedBadge: true,
        showSyncWarning: false,
        tooltipMessage: 'Metadata enrichment failed. Click to manually fix.',
      };

    default:
      assertNever(metadata_status);
  }
}

function assertNever(x: never): never {
  throw new Error(`Unexpected metadata status: ${x}`);
}

export function exhaustiveMetadataCheck(status: MetadataStatus): string {
  switch (status) {
    case 'pending': return 'pending';
    case 'enriched': return 'enriched';
    case 'unavailable': return 'unavailable';
    case 'failed': return 'failed';
    default:
      return assertNever(status);
  }
}

export function exhaustiveSyncCheck(status: SyncStatus): string {
  switch (status) {
    case 'healthy': return 'healthy';
    case 'degraded': return 'degraded';
    case 'failed': return 'failed';
    default:
      return assertNever(status as never);
  }
}

export interface ReviewDecision {
  needsReview: boolean;
  confidence: number;
  factors: string[];
}

export function calculateReviewDecision(params: {
  similarity: number;
  isExactIdMatch: boolean;
  creatorMatch?: boolean;
  languageMatch?: boolean;
  yearDrift?: number;
}): ReviewDecision {
  const factors: string[] = [];
  let confidence = params.similarity;

  if (params.isExactIdMatch) {
    return { needsReview: false, confidence: 1.0, factors: ['exact_id_match'] };
  }

  if (params.similarity < 0.70) {
    factors.push('low_similarity');
  }

  if (params.creatorMatch === false) {
    confidence -= 0.15;
    factors.push('creator_mismatch');
  }

  if (params.languageMatch === false) {
    confidence -= 0.10;
    factors.push('language_mismatch');
  }

  if (params.yearDrift !== undefined && params.yearDrift > 2) {
    confidence -= 0.10;
    factors.push('year_drift');
  }

  const needsReview = confidence < 0.75 || factors.length >= 2;

  return { needsReview, confidence, factors };
}

export function normalizeProgress(value: number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (isNaN(value)) return 0;
  return Math.max(0, Math.floor(value * 100) / 100);
}

export function compareProgress(a: number | null, b: number | null): number {
  const normA = normalizeProgress(a);
  const normB = normalizeProgress(b);
  return normA - normB;
}

export function mergeProgress(existing: number | null, incoming: number | null): number {
  const normalized1 = normalizeProgress(existing);
  const normalized2 = normalizeProgress(incoming);
  return Math.max(normalized1, normalized2);
}

export async function safeSeriesSourceUpdate(
  tx: TransactionClient,
  sourceUrl: string,
  targetSeriesId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const existing = await tx.seriesSource.findFirst({
      where: { source_url: sourceUrl },
      select: { id: true, series_id: true },
    });

    const matchCount = existing ? 1 : 0;
    if (matchCount === 0) {
      return { success: true };
    }

    if (existing.series_id === targetSeriesId) {
      return { success: true };
    }

    const targetSource = await tx.seriesSource.findFirst({
      where: { series_id: targetSeriesId, source_url: sourceUrl },
    });

    if (targetSource) {
      return { success: true };
    }

    await tx.seriesSource.update({
      where: { id: existing.id },
      data: { series_id: targetSeriesId },
    });

    return { success: true };
  } catch (error: unknown) {
    logger.error('Safe series source update failed', { error: error instanceof Error ? error.message : String(error) });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export function areLanguagesCompatible(lang1: string | null, lang2: string | null): boolean {
  if (!lang1 || !lang2) return true;
  
  const normalize = (l: string) => l.toLowerCase().replace(/[^a-z]/g, '');
  const n1 = normalize(lang1);
  const n2 = normalize(lang2);
  
  if (n1 === n2) return true;
  
  const aliases: Record<string, string[]> = {
    'en': ['english', 'eng'],
    'ja': ['japanese', 'jpn', 'jp'],
    'ko': ['korean', 'kor', 'kr'],
    'zh': ['chinese', 'chi', 'cn', 'zhtw', 'zhhk', 'zhhans', 'zhhant'],
  };
  
  for (const [code, synonyms] of Object.entries(aliases)) {
    const all = [code, ...synonyms];
    if (all.includes(n1) && all.includes(n2)) return true;
  }
  
  return false;
}

export function checkYearCompatibility(year1: number | null, year2: number | null, maxDrift: number = 3): {
  compatible: boolean;
  drift: number;
} {
  if (!year1 || !year2) return { compatible: true, drift: 0 };
  const drift = Math.abs(year1 - year2);
  return { compatible: drift <= maxDrift, drift };
}

export function generateMetadataChecksum(metadata: {
  title?: string;
  description?: string;
  cover_url?: string;
  status?: string;
}): string {
  // Using simple hash; for production use sha256 from crypto
  const content = JSON.stringify({
    title: metadata.title?.toLowerCase().trim(),
    description: metadata.description?.slice(0, 100).toLowerCase(),
    cover_url: metadata.cover_url,
    status: metadata.status,
  });
  
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

export function hasMetadataChanged(oldChecksum: string | null, newChecksum: string): boolean {
  if (!oldChecksum) return true;
  return oldChecksum !== newChecksum;
}

export interface CreatorInfo {
  authors?: string[];
  artists?: string[];
}

export function calculateEnhancedMatchScore(
  titleSimilarity: number,
  creators1: CreatorInfo | null,
  creators2: CreatorInfo | null,
  options?: { languageMatch?: boolean }
): number {
  const titleWeight = 0.7;
  const creatorWeight = 0.3;
  const languagePenalty = options?.languageMatch === false ? 0.15 : 0;
  
  let score = titleSimilarity * titleWeight;
  
  if (creators1 && creators2) {
    const authors1 = new Set((creators1.authors || []).map(a => a.toLowerCase()));
    const authors2 = new Set((creators2.authors || []).map(a => a.toLowerCase()));
    
    let authorOverlap = 0;
    for (const a of authors1) {
      if (authors2.has(a)) authorOverlap++;
    }
    
    const maxAuthors = Math.max(authors1.size, authors2.size, 1);
    score += (authorOverlap / maxAuthors) * creatorWeight;
  } else {
    score += 0.15;
  }
  
  return Math.min(1, score - languagePenalty);
}

export function createResponseValidator<T>(schema: z.ZodType<T>) {
  return {
    validateOrThrow(data: unknown): T {
      return schema.parse(data);
    },
    validateOrDefault(data: unknown, defaultValue: T): T {
      const result = schema.safeParse(data);
      return result.success ? result.data : defaultValue;
    },
  };
}

export function checkMemoryBounds(): { allowed: boolean; stats: { heapUsed: number; heapTotal: number; percentage: number } } {
  if (typeof process === 'undefined' || !process.memoryUsage) {
    return { allowed: true, stats: { heapUsed: 0, heapTotal: 0, percentage: 0 } };
  }

  const { heapUsed, heapTotal } = process.memoryUsage();
  const percentage = (heapUsed / heapTotal) * 100;
  
  const THRESHOLD = 85;
  
  return {
    allowed: percentage < THRESHOLD,
    stats: { heapUsed, heapTotal, percentage },
  };
}

export function getMemoryStats(): { heapUsed: number; heapTotal: number; rss: number; external: number } {
  if (typeof process === 'undefined' || !process.memoryUsage) {
    return { heapUsed: 0, heapTotal: 0, rss: 0, external: 0 };
  }
  const { heapUsed, heapTotal, rss, external } = process.memoryUsage();
  return { heapUsed, heapTotal, rss, external };
}

// Deterministic hash-based feature flag evaluation
export function isFeatureEnabled(flagName: string, userId?: string): boolean {
  const flag = FEATURE_FLAGS[flagName];
  if (!flag || !flag.enabled) return false;
  if (userId && flag.enabledForUsers?.includes(userId)) return true;
  if (flag.enabledPercentage !== undefined && flag.enabledPercentage < 100) {
    // Deterministic hash for consistent user experience
    const hash = userId ? userId.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 100 : 0;
    return hash < flag.enabledPercentage;
  }
  return true;
}

// Import from worker-scheduling
import {
  getMonotonicTimestamp as _getMonotonicTimestamp,
  getSchedulerConfig as _getSchedulerConfig,
  updateSchedulerConfig as _updateSchedulerConfig,
  recordJobStart as _recordJobStart,
  recordJobEnd as _recordJobEnd,
  canStartNewJob as _canStartNewJob,
} from '@/lib/bug-fixes/worker-scheduling';

import {
  calculateSafeDelay as _calculateSafeDelay,
} from '@/lib/bug-fixes/workers-concurrency';

// Re-export with explicit function signatures for better compatibility
export function getMonotonicTimestamp(): number {
  // Uses process.hrtime for monotonic time
  return _getMonotonicTimestamp();
}

export function getSchedulerConfig(schedulerName: string) {
  return _getSchedulerConfig(schedulerName);
}

export function updateSchedulerConfig(schedulerName: string, updates: any) {
  return _updateSchedulerConfig(schedulerName, updates);
}

export function recordJobStart(queueName: string, sourceName?: string): void {
  return _recordJobStart(queueName, sourceName);
}

export function recordJobEnd(queueName: string, sourceName?: string): void {
  return _recordJobEnd(queueName, sourceName);
}

/**
 * Bug 170-171: Check if a new job can start based on global concurrency limits
 * @param queueName - The name of the queue
 * @param sourceName - Optional source name for per-source limits
 * @returns boolean - true if job can start, false if limits reached
 */
export function canStartJob(queueName: string, sourceName?: string): boolean {
  return _canStartNewJob(queueName, sourceName);
}

export function calculateSafeDelay(baseDelay: number, attempt: number): number {
  const minDelayMs = 1000;
  const maxDelayMs = 300000;
  const targetTime = new Date(Date.now() + baseDelay * Math.pow(2, attempt));
  const delay = _calculateSafeDelay(targetTime, 0);
  return Math.max(minDelayMs, Math.min(maxDelayMs, delay));
}

export function getConcurrencyStats(): { globalActive: number; utilization: number } {
  return {
    globalActive: 0,
    utilization: 0,
  };
}

// ============================================================================
// Bug 106-107: Author/Artist Matching & Language Verification
// ============================================================================

export const LANGUAGE_FAMILIES: Record<string, string[]> = {
  'japanese': ['ja', 'jp', 'japanese', 'jpn'],
  'korean': ['ko', 'kr', 'korean', 'kor'],
  'chinese': ['zh', 'cn', 'chinese', 'chi', 'zhtw', 'zhhk'],
};

export function normalizeCreatorName(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export function calculateCreatorSimilarity(
  creatorsA: { name: string }[],
  creatorsB: { name: string }[]
): number {
  if (creatorsA.length === 0 || creatorsB.length === 0) return 0.5;
  const normalizedA = new Set(creatorsA.map(c => normalizeCreatorName(c.name)));
  const normalizedB = new Set(creatorsB.map(c => normalizeCreatorName(c.name)));
  let matches = 0;
  for (const name of normalizedA) {
    if (normalizedB.has(name)) matches++;
  }
  const union = new Set([...normalizedA, ...normalizedB]).size;
  return union > 0 ? matches / union : 0.5;
}

export function normalizeLanguage(lang: string | null): string {
  if (!lang) return 'unknown';
  const normalized = lang.toLowerCase().trim();
  for (const [family, codes] of Object.entries(LANGUAGE_FAMILIES)) {
    if (codes.includes(normalized)) return family;
  }
  return normalized;
}

// ============================================================================
// Bug 118-119: Publication Year Drift & Metadata Checksum
// ============================================================================

export const YEAR_DRIFT_CONFIG = {
  EXACT_MATCH_TOLERANCE: 1,
  REVIEW_THRESHOLD: 2,
  REJECT_THRESHOLD: 5,
};

// ============================================================================
// Bug 128-129: Completed Status & Dropped Series Sync
// ============================================================================

export const SYNC_ELIGIBLE_STATUSES = ['reading', 'on_hold', 'plan_to_read'] as const;
export const SYNC_EXCLUDED_STATUSES = ['dropped', 'completed'] as const;

export function handleCompletedSeriesNewChapter(
  status: string,
  currentCount: number,
  newCount: number
): { shouldNotify: boolean; newStatus: string } {
  if (status !== 'completed') return { shouldNotify: false, newStatus: status };
  if (newCount <= currentCount) return { shouldNotify: false, newStatus: 'completed' };
  return { shouldNotify: true, newStatus: 'ongoing' };
}

export function shouldSyncLibraryEntry(status: string): boolean {
  return !(SYNC_EXCLUDED_STATUSES as readonly string[]).includes(status);
}

// ============================================================================
// Bug 137-138: User Metadata Isolation
// ============================================================================

export interface UserMetadataOverride {
  user_title?: string;
  user_description?: string;
  user_cover_url?: string;
}

export const USER_OVERRIDE_ALLOWED_FIELDS = ['user_title', 'user_description', 'user_cover_url'] as const;

export function mergeUserMetadata<T extends Record<string, unknown>>(
  globalMeta: T,
  userOverride: Partial<T> | null
): T {
  if (!userOverride) return globalMeta;
  const merged = { ...globalMeta };
  for (const [key, value] of Object.entries(userOverride)) {
    if (value !== undefined && value !== null) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

export function validateUserOverride(
  override: Record<string, unknown>,
  allowedFields: readonly string[] = USER_OVERRIDE_ALLOWED_FIELDS
): { valid: boolean; invalidFields: string[] } {
  const invalidFields = Object.keys(override).filter(k => !allowedFields.includes(k));
  return { valid: invalidFields.length === 0, invalidFields };
}

// ============================================================================
// Bug 150: Trending Rank Deterministic Ordering
// ============================================================================

export interface TrendingSort {
  rank: number;
  tiebreaker: string;
}

export function buildTrendingSortKey(item: { trending_rank?: number | null; id: string }): TrendingSort {
  return {
    rank: item.trending_rank ?? Number.MAX_SAFE_INTEGER,
    tiebreaker: item.id,
  };
}

export function createTrendingCursor(item: { trending_rank?: number | null; id: string }): string {
  const rank = item.trending_rank ?? Number.MAX_SAFE_INTEGER;
  return Buffer.from(`${rank}:${item.id}`).toString('base64url');
}

export function parseTrendingCursor(cursor: string): { rank: number; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
    const [rankStr, id] = decoded.split(':');
    const rank = parseInt(rankStr, 10);
    if (isNaN(rank) || !id) return null;
    return { rank, id };
  } catch {
    return null;
  }
}

// ============================================================================
// Bug 14: Progress precision
// ============================================================================

export const PROGRESS_PRECISION = 2;

// ============================================================================
// Bug 112: Cover URL Expiry
// ============================================================================

export interface CoverUrlState {
  url: string;
  lastVerified: Date | null;
  failureCount: number;
}

export const COVER_EXPIRY_CONFIG = {
  VALID_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000,
  MAX_FAILURES: 3,
};

export function shouldVerifyCover(state: CoverUrlState): boolean {
  if (!state.lastVerified) return true;
  if (state.failureCount >= COVER_EXPIRY_CONFIG.MAX_FAILURES) return false;
  return Date.now() - state.lastVerified.getTime() > COVER_EXPIRY_CONFIG.VALID_EXPIRY_MS;
}

export function isValidCoverUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

// ============================================================================
// Bug 121, 136: Source Verification & FK Constraints
// ============================================================================

export interface SourceVerificationResult {
  isValid: boolean;
  sourceName: string;
  sourceId: string | null;
}

export const SOURCE_URL_PATTERNS: Record<string, RegExp> = {
  'mangadex': /mangadex\.org\/(?:title|manga)\/([a-f0-9-]+)/i,
  'mangaupdates': /mangaupdates\.com\/series\/([a-z0-9]+)/i,
};

export function verifySourceUrl(url: string): SourceVerificationResult {
  for (const [sourceName, pattern] of Object.entries(SOURCE_URL_PATTERNS)) {
    const match = url.match(pattern);
    if (match) return { isValid: true, sourceName, sourceId: match[1] };
  }
  return { isValid: false, sourceName: 'unknown', sourceId: null };
}

export function validateLibraryEntryReferences(entry: {
  series_id?: string | null;
  user_id?: string | null;
}): { valid: boolean; missingRefs: string[] } {
  const missingRefs: string[] = [];
  if (!entry.series_id) missingRefs.push('series_id');
  if (!entry.user_id) missingRefs.push('user_id');
  return { valid: missingRefs.length === 0, missingRefs };
}

// ============================================================================
// Bug 170-171: Global Concurrency Cap
// ============================================================================

export const CONCURRENCY_CONFIG = {
  MAX_GLOBAL_JOBS: 50,
  MAX_PER_QUEUE: 10,
  MAX_PER_SOURCE: 3,
};

// ============================================================================
// Bug 179: Dynamic Scheduler Configuration
// ============================================================================

export interface SchedulerConfig {
  cronExpression: string;
  intervalMs: number;
  enabled: boolean;
}

export const DEFAULT_SCHEDULER_CONFIGS: Record<string, SchedulerConfig> = {
  'poll-source': { cronExpression: '*/15 * * * *', intervalMs: 900000, enabled: true },
  'resolution': { cronExpression: '*/5 * * * *', intervalMs: 300000, enabled: true },
  'reconciliation': { cronExpression: '0 */6 * * *', intervalMs: 21600000, enabled: true },
};

// ============================================================================
// Bug 184: API Response Schema Validation
// ============================================================================

export const PaginatedResponseSchema = z.object({
  data: z.array(z.unknown()),
  pagination: z.object({
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
    hasMore: z.boolean(),
  }),
});

export const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  requestId: z.string().optional(),
  status: z.number(),
});

// ============================================================================
// Bug 190: Node Process Memory Bounds
// ============================================================================

export const MEMORY_CONFIG = {
  MAX_HEAP_MB: 512,
  WARNING_THRESHOLD: 0.75,
  CRITICAL_THRESHOLD: 0.90,
};

export interface MemoryStats {
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
  utilization: number;
  shouldRejectRequests: boolean;
}

// ============================================================================
// Bug 192: Feature Flags Centralization
// ============================================================================

export interface FeatureFlag {
  name: string;
  enabled: boolean;
  enabledForUsers: string[];
  enabledPercentage: number;
  description?: string;
}

export const FEATURE_FLAGS: Record<string, FeatureFlag> = {
  'new_chapter_detection': {
    name: 'new_chapter_detection',
    enabled: true,
    enabledForUsers: [],
    enabledPercentage: 100,
    description: 'Enable new chapter detection pipeline',
  },
  'enhanced_metadata_matching': {
    name: 'enhanced_metadata_matching',
    enabled: true,
    enabledForUsers: [],
    enabledPercentage: 100,
    description: 'Enable enhanced multi-factor metadata matching',
  },
};

/**
 * Deterministic hash based feature flag check
 */
export function setFeatureFlag(name: string, updates: Partial<FeatureFlag>): void {
  if (FEATURE_FLAGS[name]) {
    Object.assign(FEATURE_FLAGS[name], updates);
  }
}

export function getAllFeatureFlags(): Record<string, FeatureFlag> {
  return { ...FEATURE_FLAGS };
}

// ============================================================================
// Bug 196-197: Migration Compatibility Checks
// ============================================================================

export interface MigrationCheck {
  risk: string;
  isBackwardCompatible: boolean;
  requiresDowntime: boolean;
  affectedTables: string[];
}

export const MIGRATION_RISK_PATTERNS = {
  HIGH_RISK: [/DROP\s+TABLE/i, /TRUNCATE/i, /DROP\s+COLUMN/i],
  MEDIUM_RISK: [/ALTER\s+TABLE.+ALTER\s+COLUMN/i, /RENAME/i],
  LOW_RISK: [/ADD\s+COLUMN/i, /CREATE\s+INDEX/i],
};

export function analyzeMigrationRisk(sql: string): MigrationCheck {
  for (const pattern of MIGRATION_RISK_PATTERNS.HIGH_RISK) {
    if (pattern.test(sql)) {
      return { risk: 'high', isBackwardCompatible: false, requiresDowntime: true, affectedTables: [] };
    }
  }
  for (const pattern of MIGRATION_RISK_PATTERNS.MEDIUM_RISK) {
    if (pattern.test(sql)) {
      return { risk: 'medium', isBackwardCompatible: true, requiresDowntime: false, affectedTables: [] };
    }
  }
  return { risk: 'low', isBackwardCompatible: true, requiresDowntime: false, affectedTables: [] };
}
