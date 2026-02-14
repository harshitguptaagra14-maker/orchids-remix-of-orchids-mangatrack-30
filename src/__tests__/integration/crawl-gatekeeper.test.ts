/**
 * CrawlGatekeeper Integration Tests
 * 
 * Tests the demand-driven crawling system including:
 * - Queue protection thresholds
 * - Tier-based crawl rules
 * - Priority assignment
 * - Edge cases and error handling
 */

import { CrawlGatekeeper, CrawlReason, GatekeeperResponse, THRESHOLDS } from '@/lib/crawl-gatekeeper';

// Mock dependencies
jest.mock('@/lib/queues', () => ({
  syncSourceQueue: {
    add: jest.fn().mockResolvedValue({}),
    getJobCounts: jest.fn().mockResolvedValue({ waiting: 0, delayed: 0 }),
  },
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    seriesSource: {
      findUnique: jest.fn(),
    },
  },
  withRetry: jest.fn((fn: any) => fn()),
}));

import { syncSourceQueue } from '@/lib/queues';
import { prisma } from '@/lib/prisma';

describe('CrawlGatekeeper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('shouldEnqueue', () => {
    describe('System Protection (Queue Depth)', () => {
      it('should allow all jobs when queue is healthy (< 2500)', async () => {
        (syncSourceQueue.getJobCounts as jest.Mock).mockResolvedValue({ waiting: 1000, delayed: 500 });
        
        const result = await CrawlGatekeeper.shouldEnqueue('source-1', 'C', 'PERIODIC');
        
        expect(result.allowed).toBe(true);
        expect(result.priority).toBe(4); // P3 for Tier C PERIODIC (no trackers)
      });

      it('should drop Tier C periodic jobs when elevated (> 5000)', async () => {
        (syncSourceQueue.getJobCounts as jest.Mock).mockResolvedValue({ waiting: 5001, delayed: 0 });
        
        const result = await CrawlGatekeeper.shouldEnqueue('source-1', 'C', 'PERIODIC');
        
        // Tier C PERIODIC → P3, elevated drops P3
        expect(result.allowed).toBe(false);
      });

      it('should allow Tier A/B periodic jobs when elevated', async () => {
        (syncSourceQueue.getJobCounts as jest.Mock).mockResolvedValue({ waiting: 5001, delayed: 0 });
        (prisma.seriesSource.findUnique as jest.Mock).mockResolvedValue({ last_success_at: null });
        
        // Tier A/B PERIODIC → P2, elevated allows P2
        const resultA = await CrawlGatekeeper.shouldEnqueue('source-1', 'A', 'PERIODIC');
        const resultB = await CrawlGatekeeper.shouldEnqueue('source-2', 'B', 'PERIODIC');
        
        expect(resultA.allowed).toBe(true);
        expect(resultB.allowed).toBe(true);
      });

      it('should drop periodic jobs when critical (> 15000)', async () => {
        (syncSourceQueue.getJobCounts as jest.Mock).mockResolvedValue({ waiting: 15001, delayed: 0 });
        
        // critical: only P0 allowed
        const resultA = await CrawlGatekeeper.shouldEnqueue('source-1', 'A', 'PERIODIC');
        const resultB = await CrawlGatekeeper.shouldEnqueue('source-2', 'B', 'PERIODIC');
        const resultC = await CrawlGatekeeper.shouldEnqueue('source-3', 'C', 'PERIODIC');
        
        expect(resultA.allowed).toBe(false);
        expect(resultB.allowed).toBe(false);
        expect(resultC.allowed).toBe(false);
      });

      it('should allow USER_REQUEST jobs even when critical', async () => {
        (syncSourceQueue.getJobCounts as jest.Mock).mockResolvedValue({ waiting: 15001, delayed: 0 });
        
        // USER_REQUEST → P0, critical allows P0
        const result = await CrawlGatekeeper.shouldEnqueue('source-1', 'C', 'USER_REQUEST');
        
        expect(result.allowed).toBe(true);
        expect(result.priority).toBe(1); // P0
      });

      it('should allow GAP_RECOVERY jobs even when critical', async () => {
        (syncSourceQueue.getJobCounts as jest.Mock).mockResolvedValue({ waiting: 15001, delayed: 0 });
        
        // GAP_RECOVERY → P0, critical allows P0
        const result = await CrawlGatekeeper.shouldEnqueue('source-1', 'B', 'GAP_RECOVERY');
        
        expect(result.allowed).toBe(true);
        expect(result.priority).toBe(1); // P0
      });

      it('should halt all jobs on meltdown (> 20000)', async () => {
        (syncSourceQueue.getJobCounts as jest.Mock).mockResolvedValue({ waiting: 20001, delayed: 0 });
        
        const result = await CrawlGatekeeper.shouldEnqueue('source-1', 'A', 'USER_REQUEST');
        
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('meltdown');
      });
    });

    describe('Tier A One-Shot Rule', () => {
      it('should allow first periodic crawl for Tier A (no last_success_at)', async () => {
        (syncSourceQueue.getJobCounts as jest.Mock).mockResolvedValue({ waiting: 100, delayed: 0 });
        (prisma.seriesSource.findUnique as jest.Mock).mockResolvedValue({ last_success_at: null });
        
        const result = await CrawlGatekeeper.shouldEnqueue('source-1', 'A', 'PERIODIC');
        
        expect(result.allowed).toBe(true);
        expect(result.priority).toBe(3); // P2 for Tier A PERIODIC
      });

      it('should block subsequent periodic crawls for Tier A (has last_success_at)', async () => {
        (syncSourceQueue.getJobCounts as jest.Mock).mockResolvedValue({ waiting: 100, delayed: 0 });
        (prisma.seriesSource.findUnique as jest.Mock).mockResolvedValue({ 
          last_success_at: new Date('2025-01-01') 
        });
        
        const result = await CrawlGatekeeper.shouldEnqueue('source-1', 'A', 'PERIODIC');
        
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('one-shot');
      });

      it('should allow DISCOVERY for Tier A even after one-shot', async () => {
        (syncSourceQueue.getJobCounts as jest.Mock).mockResolvedValue({ waiting: 100, delayed: 0 });
        
        const result = await CrawlGatekeeper.shouldEnqueue('source-1', 'A', 'DISCOVERY');
        
        expect(result.allowed).toBe(true);
      });

      it('should allow USER_REQUEST for Tier A even after one-shot', async () => {
        (syncSourceQueue.getJobCounts as jest.Mock).mockResolvedValue({ waiting: 100, delayed: 0 });
        
        const result = await CrawlGatekeeper.shouldEnqueue('source-1', 'A', 'USER_REQUEST');
        
        expect(result.allowed).toBe(true);
      });
    });

    describe('Priority Assignment', () => {
      beforeEach(() => {
        (syncSourceQueue.getJobCounts as jest.Mock).mockResolvedValue({ waiting: 100, delayed: 0 });
        (prisma.seriesSource.findUnique as jest.Mock).mockResolvedValue({ last_success_at: null });
      });

      it('should assign priority 1 (P0) for USER_REQUEST', async () => {
        const result = await CrawlGatekeeper.shouldEnqueue('source-1', 'C', 'USER_REQUEST');
        expect(result.priority).toBe(1);
        expect(result.jobPriority).toBe('P0');
      });

      it('should assign priority 1 (P0) for GAP_RECOVERY', async () => {
        const result = await CrawlGatekeeper.shouldEnqueue('source-1', 'C', 'GAP_RECOVERY');
        expect(result.priority).toBe(1);
        expect(result.jobPriority).toBe('P0');
      });

      it('should assign priority 3 (P2) for DISCOVERY', async () => {
        const result = await CrawlGatekeeper.shouldEnqueue('source-1', 'C', 'DISCOVERY');
        expect(result.priority).toBe(3);
        expect(result.jobPriority).toBe('P2');
      });

      it('should assign priority 3 (P2) for Tier A PERIODIC', async () => {
        const result = await CrawlGatekeeper.shouldEnqueue('source-1', 'A', 'PERIODIC');
        expect(result.priority).toBe(3);
        expect(result.jobPriority).toBe('P2');
      });

      it('should assign priority 3 (P2) for Tier B PERIODIC', async () => {
        const result = await CrawlGatekeeper.shouldEnqueue('source-1', 'B', 'PERIODIC');
        expect(result.priority).toBe(3);
        expect(result.jobPriority).toBe('P2');
      });

      it('should assign priority 4 (P3) for Tier C PERIODIC', async () => {
        const result = await CrawlGatekeeper.shouldEnqueue('source-1', 'C', 'PERIODIC');
        expect(result.priority).toBe(4);
        expect(result.jobPriority).toBe('P3');
      });
    });

    describe('Edge Cases', () => {
      it('should handle unknown tier gracefully (default to Tier C behavior)', async () => {
        (syncSourceQueue.getJobCounts as jest.Mock).mockResolvedValue({ waiting: 100, delayed: 0 });
        
        const result = await CrawlGatekeeper.shouldEnqueue('source-1', 'UNKNOWN' as any, 'PERIODIC');
        
        expect(result.allowed).toBe(true);
        expect(result.priority).toBe(4); // P3 for unknown tier
      });

      it('should handle queue depth error gracefully (assume healthy)', async () => {
        (syncSourceQueue.getJobCounts as jest.Mock).mockRejectedValue(new Error('Redis error'));
        
        const result = await CrawlGatekeeper.shouldEnqueue('source-1', 'C', 'PERIODIC');
        
        // Should assume healthy on error (depth=0) to avoid deadlocks
        expect(result.allowed).toBe(true);
      });

      it('should handle missing source gracefully for Tier A check', async () => {
        (syncSourceQueue.getJobCounts as jest.Mock).mockResolvedValue({ waiting: 100, delayed: 0 });
        (prisma.seriesSource.findUnique as jest.Mock).mockResolvedValue(null);
        
        const result = await CrawlGatekeeper.shouldEnqueue('source-1', 'A', 'PERIODIC');
        
        // No source means no last_success_at, so should allow
        expect(result.allowed).toBe(true);
      });

      it('should handle empty string source ID', async () => {
        (syncSourceQueue.getJobCounts as jest.Mock).mockResolvedValue({ waiting: 100, delayed: 0 });
        
        const result = await CrawlGatekeeper.shouldEnqueue('', 'C', 'PERIODIC');
        
        expect(result.allowed).toBe(true); // No validation on ID, just passes through
      });
    });
  });

  describe('enqueueIfAllowed', () => {
    beforeEach(() => {
      (syncSourceQueue.getJobCounts as jest.Mock).mockResolvedValue({ waiting: 100, delayed: 0 });
      (syncSourceQueue.add as jest.Mock).mockResolvedValue({});
    });

    it('should enqueue job when allowed', async () => {
      const result = await CrawlGatekeeper.enqueueIfAllowed('source-1', 'C', 'USER_REQUEST');
      
      expect(result).toBe(true);
      expect(syncSourceQueue.add).toHaveBeenCalledWith(
        'sync-source-1',
        expect.objectContaining({ seriesSourceId: 'source-1' }),
        expect.objectContaining({ 
          jobId: 'sync-source-1',
          priority: 1,
          removeOnComplete: true 
        })
      );
    });

    it('should not enqueue job when not allowed', async () => {
      (syncSourceQueue.getJobCounts as jest.Mock).mockResolvedValue({ waiting: 20001, delayed: 0 });
      
      const result = await CrawlGatekeeper.enqueueIfAllowed('source-1', 'C', 'PERIODIC');
      
      expect(result).toBe(false);
      expect(syncSourceQueue.add).not.toHaveBeenCalled();
    });

    it('should merge additional job data', async () => {
      await CrawlGatekeeper.enqueueIfAllowed('source-1', 'C', 'GAP_RECOVERY', {
        targetChapters: [1, 2, 3]
      });
      
      expect(syncSourceQueue.add).toHaveBeenCalledWith(
        'sync-source-1',
        expect.objectContaining({ 
          seriesSourceId: 'source-1',
          targetChapters: [1, 2, 3]
        }),
        expect.any(Object)
      );
    });

    it('should handle queue add error gracefully', async () => {
      (syncSourceQueue.add as jest.Mock).mockRejectedValue(new Error('Queue error'));
      
      await expect(
        CrawlGatekeeper.enqueueIfAllowed('source-1', 'C', 'USER_REQUEST')
      ).rejects.toThrow('Queue error');
    });
  });
});

describe('Threshold Constants', () => {
  it('should have correct threshold values', () => {
    expect(THRESHOLDS.HEALTHY).toBe(2500);
    expect(THRESHOLDS.ELEVATED).toBe(5000);
    expect(THRESHOLDS.OVERLOADED).toBe(10000);
    expect(THRESHOLDS.CRITICAL).toBe(15000);
    expect(THRESHOLDS.MELTDOWN).toBe(20000);
  });

  it('should have thresholds in ascending order', () => {
    expect(THRESHOLDS.HEALTHY).toBeLessThan(THRESHOLDS.ELEVATED);
    expect(THRESHOLDS.ELEVATED).toBeLessThan(THRESHOLDS.OVERLOADED);
    expect(THRESHOLDS.OVERLOADED).toBeLessThan(THRESHOLDS.CRITICAL);
    expect(THRESHOLDS.CRITICAL).toBeLessThan(THRESHOLDS.MELTDOWN);
  });
});
