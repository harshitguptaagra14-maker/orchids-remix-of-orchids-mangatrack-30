import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  checkRateLimit,
  handleApiError,
  ApiError,
  ErrorCodes,
  getClientIp,
  getMiddlewareUser,
  validateOrigin,
  validateUUID,
} from "@/lib/api-utils"

// POST - like an activity
export async function POST(
  request: Request,
  { params }: { params: Promise<{ activityId: string }> }
) {
  try {
    validateOrigin(request)
    const user = await getMiddlewareUser()
    if (!user) throw new ApiError("Unauthorized", 401, ErrorCodes.UNAUTHORIZED)

    if (!await checkRateLimit(`like:${user.id}`, 60, 60000)) {
      throw new ApiError("Too many requests", 429, ErrorCodes.RATE_LIMITED)
    }

    const { activityId } = await params

    // BUG FIX: Validate activityId is a valid UUID
    validateUUID(activityId, "activityId")

    // Verify activity exists
    const activity = await prisma.activity.findUnique({ where: { id: activityId } })
    if (!activity) throw new ApiError("Activity not found", 404, ErrorCodes.NOT_FOUND)

    // Upsert (idempotent)
    await prisma.activityLike.upsert({
      where: { activity_id_user_id: { activity_id: activityId, user_id: user.id } },
      create: { activity_id: activityId, user_id: user.id },
      update: {},
    })

    const likeCount = await prisma.activityLike.count({ where: { activity_id: activityId } })

    return NextResponse.json({ liked: true, like_count: likeCount })
  } catch (error: unknown) {
    return handleApiError(error)
  }
}

// DELETE - unlike an activity
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ activityId: string }> }
) {
  try {
    validateOrigin(request)
    const user = await getMiddlewareUser()
    if (!user) throw new ApiError("Unauthorized", 401, ErrorCodes.UNAUTHORIZED)

    if (!await checkRateLimit(`like:${user.id}`, 60, 60000)) {
      throw new ApiError("Too many requests", 429, ErrorCodes.RATE_LIMITED)
    }

    const { activityId } = await params

    // BUG FIX: Validate activityId is a valid UUID
    validateUUID(activityId, "activityId")

    await prisma.activityLike.deleteMany({
      where: { activity_id: activityId, user_id: user.id },
    })

    const likeCount = await prisma.activityLike.count({ where: { activity_id: activityId } })

    return NextResponse.json({ liked: false, like_count: likeCount })
  } catch (error: unknown) {
    return handleApiError(error)
  }
}
