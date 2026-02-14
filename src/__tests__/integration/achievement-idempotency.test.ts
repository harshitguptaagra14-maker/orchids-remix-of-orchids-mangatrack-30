import { checkAchievements, AchievementTrigger } from '@/lib/gamification/achievements'

const mockUserId = '550e8400-e29b-41d4-a716-446655440000'

const mockAchievement = {
  id: 'ach-001',
  code: 'reader_novice',
  name: 'Novice Reader',
  description: 'Read 10 chapters',
  xp_reward: 100,
  rarity: 'common',
  is_seasonal: false,
  season_id: null,
  criteria: { type: 'chapter_count', threshold: 10 },
  created_at: new Date(),
  updated_at: new Date(),
}

const mockSeasonalAchievement = {
  id: 'ach-002',
  code: 'winter_reader',
  name: 'Winter Reader',
  description: 'Read 50 chapters this season',
  xp_reward: 500,
  rarity: 'rare',
  is_seasonal: true,
  season_id: null,
  criteria: { type: 'chapter_count', threshold: 50 },
  created_at: new Date(),
  updated_at: new Date(),
}

const mockSeason = {
  id: 'season-winter-2026',
  code: 'WINTER_2026',
  name: 'Winter 2026',
  starts_at: new Date('2026-01-01'),
  ends_at: new Date('2026-03-31'),
  is_active: true,
  created_at: new Date(),
}

const mockUser = {
  id: mockUserId,
  xp: 500,
  level: 3,
  chapters_read: 15,
  season_xp: 200,
  current_season: 'WINTER_2026',
}

const createMockTx = () => ({
  achievement: {
    findMany: jest.fn(),
  },
  season: {
    findFirst: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  userAchievement: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  seasonalUserAchievement: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  libraryEntry: {
    count: jest.fn(),
  },
  follow: {
    count: jest.fn(),
  },
  activity: {
    create: jest.fn(),
  },
  // The actual code uses $queryRaw for INSERT ... ON CONFLICT
  $queryRaw: jest.fn(),
})

jest.mock('@/lib/gamification/activity', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/gamification/xp', () => ({
  addXp: jest.fn().mockReturnValue({ xp: 600 }),
  calculateLevel: jest.fn().mockReturnValue(4),
}))

jest.mock('@/lib/gamification/seasons', () => ({
  calculateSeasonXpUpdate: jest.fn().mockReturnValue({ season_xp: 300, current_season: 'WINTER_2026' }),
}))

describe('Achievement Idempotency Tests', () => {
  let mockTx: ReturnType<typeof createMockTx>

  beforeEach(() => {
    jest.clearAllMocks()
    mockTx = createMockTx()

    mockTx.user.findUnique.mockResolvedValue(mockUser)
    mockTx.user.update.mockResolvedValue({ ...mockUser, xp: mockUser.xp + 100 })
    mockTx.season.findFirst.mockResolvedValue(mockSeason)
  })

  describe('Permanent Achievement Idempotency', () => {
    it('should not unlock when $queryRaw returns empty (already exists via ON CONFLICT DO NOTHING)', async () => {
      mockTx.achievement.findMany
        .mockResolvedValueOnce([mockAchievement]) // permanent candidates
        .mockResolvedValueOnce([]) // seasonal candidates
      
      // $queryRaw returns [] means INSERT hit ON CONFLICT DO NOTHING (already existed)
      mockTx.$queryRaw.mockResolvedValue([])

      const result = await checkAchievements(
        mockTx as any,
        mockUserId,
        'chapter_read' as AchievementTrigger
      )

      expect(result).toHaveLength(0)
      expect(mockTx.user.update).not.toHaveBeenCalled()
    })

    it('should award XP only once for new achievement unlock', async () => {
      mockTx.achievement.findMany
        .mockResolvedValueOnce([mockAchievement]) // permanent candidates
        .mockResolvedValueOnce([]) // seasonal candidates
      
      // $queryRaw returns a row means INSERT succeeded (new unlock)
      mockTx.$queryRaw.mockResolvedValue([{ already_existed: false }])

      const result = await checkAchievements(
        mockTx as any,
        mockUserId,
        'chapter_read' as AchievementTrigger
      )

      expect(result).toHaveLength(1)
      expect(result[0].code).toBe('reader_novice')
      expect(result[0].xp_reward).toBe(100)
      // XP should be applied via user.update
      expect(mockTx.user.update).toHaveBeenCalledTimes(1)
    })
  })

  describe('Seasonal Achievement Idempotency', () => {
    it('should not unlock seasonal when already exists', async () => {
      mockTx.achievement.findMany
        .mockResolvedValueOnce([]) // permanent
        .mockResolvedValueOnce([mockSeasonalAchievement]) // seasonal
      
      mockTx.user.findUnique.mockResolvedValue({ ...mockUser, chapters_read: 55 })
      
      // $queryRaw returns [] = already existed
      mockTx.$queryRaw.mockResolvedValue([])

      const result = await checkAchievements(
        mockTx as any,
        mockUserId,
        'chapter_read' as AchievementTrigger
      )

      expect(result).toHaveLength(0)
      expect(mockTx.user.update).not.toHaveBeenCalled()
    })

    it('should award XP for new seasonal achievement unlock', async () => {
      mockTx.achievement.findMany
        .mockResolvedValueOnce([]) // permanent
        .mockResolvedValueOnce([mockSeasonalAchievement]) // seasonal
      
      mockTx.user.findUnique.mockResolvedValue({ ...mockUser, chapters_read: 55 })
      
      // $queryRaw returns a row = new insert
      mockTx.$queryRaw.mockResolvedValue([{ already_existed: false }])

      const result = await checkAchievements(
        mockTx as any,
        mockUserId,
        'chapter_read' as AchievementTrigger
      )

      expect(result).toHaveLength(1)
      expect(result[0].code).toBe('winter_reader')
      expect(result[0].is_seasonal).toBe(true)
      expect(mockTx.user.update).toHaveBeenCalledTimes(1)
    })
  })

  describe('Concurrent Trigger Handling', () => {
    it('should handle P2002-like unique constraint error gracefully', async () => {
      mockTx.achievement.findMany
        .mockResolvedValueOnce([mockAchievement])
        .mockResolvedValueOnce([])
      
      // Simulate a unique constraint error with code property
      const uniqueError = new Error('Unique constraint failed');
      (uniqueError as any).code = 'P2002';
      mockTx.$queryRaw.mockRejectedValue(uniqueError)

      const result = await checkAchievements(
        mockTx as any,
        mockUserId,
        'chapter_read' as AchievementTrigger
      )

      // P2002 is caught and silently handled
      expect(result).toHaveLength(0)
      expect(mockTx.user.update).not.toHaveBeenCalled()
    })

    it('should re-throw errors with non-P2002 code', async () => {
      mockTx.achievement.findMany
        .mockResolvedValueOnce([mockAchievement])
        .mockResolvedValueOnce([])
      
      const dbError = new Error('Database connection failed');
      (dbError as any).code = 'P1001'; // Non-P2002 code
      mockTx.$queryRaw.mockRejectedValue(dbError)

      await expect(
        checkAchievements(mockTx as any, mockUserId, 'chapter_read' as AchievementTrigger)
      ).rejects.toThrow('Database connection failed')
    })

    it('should silently catch errors without code property', async () => {
      mockTx.achievement.findMany
        .mockResolvedValueOnce([mockAchievement])
        .mockResolvedValueOnce([])
      
      mockTx.$queryRaw.mockRejectedValue(new Error('Some generic error'))

      // Errors without .code are silently caught (not re-thrown)
      const result = await checkAchievements(
        mockTx as any, mockUserId, 'chapter_read' as AchievementTrigger
      )
      expect(result).toHaveLength(0)
    })
  })
})
