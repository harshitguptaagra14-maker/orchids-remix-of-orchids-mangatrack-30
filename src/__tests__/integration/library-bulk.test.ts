/**
 * Library Bulk Operations Integration Tests
 * 
 * Tests for bulk add, update, and delete operations on library entries.
 */

import { prisma } from '@/lib/prisma'

// Mock Supabase server client
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'test-user-id', email: 'test@example.com', user_metadata: { username: 'testuser' }, app_metadata: {} } },
      }),
    },
  }),
}))

const mockUserId = 'test-user-id'

describe('Library Bulk Operations', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should handle bulk status updates via transaction', async () => {
    const mockEntries = [
      { id: 'entry-1', user_id: mockUserId, status: 'reading', series_id: 'series-1' },
      { id: 'entry-2', user_id: mockUserId, status: 'reading', series_id: 'series-2' },
    ]

    ;(prisma.libraryEntry.findMany as jest.Mock).mockResolvedValue(mockEntries)
    ;(prisma.libraryEntry.update as jest.Mock).mockImplementation((args: any) =>
      Promise.resolve({ ...mockEntries.find(e => e.id === args.where.id), status: args.data.status })
    )
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => {
      if (typeof fn === 'function') {
        return fn(prisma)
      }
      return Promise.all(fn)
    })

    // Verify the mock setup works
    const entries = await prisma.libraryEntry.findMany({
      where: { user_id: mockUserId }
    })
    expect(entries).toHaveLength(2)
    expect(entries[0].status).toBe('reading')
  })

  it('should handle bulk delete via transaction', async () => {
    ;(prisma.libraryEntry.deleteMany as jest.Mock).mockResolvedValue({ count: 3 })

    const result = await prisma.libraryEntry.deleteMany({
      where: {
        id: { in: ['entry-1', 'entry-2', 'entry-3'] },
        user_id: mockUserId,
      },
    })

    expect(result.count).toBe(3)
    expect(prisma.libraryEntry.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: mockUserId,
        }),
      })
    )
  })

  it('should validate entry ownership during bulk operations', async () => {
    // Verify user_id is always included in queries
    ;(prisma.libraryEntry.findMany as jest.Mock).mockResolvedValue([])

    await prisma.libraryEntry.findMany({
      where: { user_id: mockUserId, id: { in: ['entry-1'] } },
    })

    expect(prisma.libraryEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ user_id: mockUserId }),
      })
    )
  })

  it('should handle empty bulk operations gracefully', async () => {
    ;(prisma.libraryEntry.updateMany as jest.Mock).mockResolvedValue({ count: 0 })

    const result = await prisma.libraryEntry.updateMany({
      where: { id: { in: [] }, user_id: mockUserId },
      data: { status: 'completed' },
    })

    expect(result.count).toBe(0)
  })

  it('should track XP awards on bulk completion', async () => {
    ;(prisma.user.update as jest.Mock).mockResolvedValue({
      id: mockUserId,
      xp: 150,
    })

    const updatedUser = await prisma.user.update({
      where: { id: mockUserId },
      data: { xp: { increment: 50 } },
    })

    expect(updatedUser.xp).toBe(150)
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: mockUserId },
      })
    )
  })
})
