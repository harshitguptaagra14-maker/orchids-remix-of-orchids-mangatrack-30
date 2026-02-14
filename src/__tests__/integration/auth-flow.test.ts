import { redirect } from 'next/navigation'
import Home from '@/app/page'

// Mock next/navigation
jest.mock('next/navigation', () => ({
  redirect: jest.fn(),
}))

// Mock the cached user module (what the page actually uses)
jest.mock('@/lib/supabase/cached-user', () => ({
  getCachedUser: jest.fn(),
}))

// Mock Supabase server client (for fallback paths)
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: null } }),
    },
  }),
}))

// Mock the landing component to avoid rendering complexity in tests
jest.mock('@/components/landing/ScrollytellingLanding', () => {
  return function MockLanding() { return null }
})

import { getCachedUser } from '@/lib/supabase/cached-user'

describe('Home Page Onboarding Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should redirect to /onboarding if logged in but no username', async () => {
    const mockUser = {
      id: 'user-1',
      email: 'test@example.com',
      user_metadata: {},
      app_metadata: {},
    }

    ;(getCachedUser as jest.Mock).mockResolvedValue(mockUser)

    await Home()

    expect(redirect).toHaveBeenCalledWith('/onboarding')
  })

  it('should redirect to /library if logged in and has username in user_metadata', async () => {
    const mockUser = {
      id: 'user-1',
      email: 'test@example.com',
      user_metadata: { username: 'testuser' },
      app_metadata: {},
    }

    ;(getCachedUser as jest.Mock).mockResolvedValue(mockUser)

    await Home()

    expect(redirect).toHaveBeenCalledWith('/library')
  })

  it('should redirect to /library if logged in and has username in app_metadata', async () => {
    const mockUser = {
      id: 'user-1',
      email: 'test@example.com',
      user_metadata: {},
      app_metadata: { username: 'testuser' },
    }

    ;(getCachedUser as jest.Mock).mockResolvedValue(mockUser)

    await Home()

    expect(redirect).toHaveBeenCalledWith('/library')
  })

  it('should NOT redirect if not logged in', async () => {
    ;(getCachedUser as jest.Mock).mockResolvedValue(null)

    // Should render landing page (returns JSX, not redirect)
    const result = await Home()

    expect(redirect).not.toHaveBeenCalled()
    // Page returns the landing component when no user
    expect(result).toBeDefined()
  })
})
