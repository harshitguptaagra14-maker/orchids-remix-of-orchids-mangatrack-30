import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  checkRateLimit,
  handleApiError,
  ApiError,
  ErrorCodes,
  getMiddlewareUser,
  validateOrigin,
  validateContentType,
  validateUUID,
  sanitizeInput,
  validateJsonSize,
} from "@/lib/api-utils"

// GET - list comments for an activity
export async function GET(
  request: Request,
  { params }: { params: Promise<{ activityId: string }> }
) {
  try {
    const user = await getMiddlewareUser()
    if (!user) throw new ApiError("Unauthorized", 401, ErrorCodes.UNAUTHORIZED)

      if (!await checkRateLimit(`comments-get:${user.id}`, 60, 60000)) {
      throw new ApiError("Too many requests", 429, ErrorCodes.RATE_LIMITED)
    }

    const { activityId } = await params

    // BUG FIX: Validate activityId is a valid UUID to prevent Prisma errors
    validateUUID(activityId, "activityId")

    const url = new URL(request.url)
    const cursor = url.searchParams.get("cursor")
    const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") || "20") || 20), 50)

    // BUG FIX: Validate cursor is a valid UUID if provided
    if (cursor) {
      validateUUID(cursor, "cursor")
    }

    const comments = await prisma.activityComment.findMany({
      where: { activity_id: activityId },
      orderBy: { created_at: "asc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        user: {
          select: { id: true, username: true, avatar_url: true },
        },
      },
    })

    const hasMore = comments.length > limit
    const items = hasMore ? comments.slice(0, limit) : comments

    return NextResponse.json({
      items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    })
  } catch (error: unknown) {
    return handleApiError(error)
  }
}

// POST - add a comment to an activity
export async function POST(
  request: Request,
  { params }: { params: Promise<{ activityId: string }> }
) {
  try {
    validateOrigin(request)
    validateContentType(request)

    // BUG FIX: Validate JSON body size before parsing
    await validateJsonSize(request, 4096) // 4KB max for a comment

    const user = await getMiddlewareUser()
    if (!user) throw new ApiError("Unauthorized", 401, ErrorCodes.UNAUTHORIZED)

    if (!await checkRateLimit(`comment:${user.id}`, 30, 60000)) {
      throw new ApiError("Too many requests", 429, ErrorCodes.RATE_LIMITED)
    }

    const { activityId } = await params

    // BUG FIX: Validate activityId is a valid UUID
    validateUUID(activityId, "activityId")

    let body
    try {
      body = await request.json()
    } catch {
      throw new ApiError("Invalid JSON body", 400, ErrorCodes.BAD_REQUEST)
    }

    const rawContent = typeof body.content === "string" ? body.content.trim() : ""

    if (!rawContent || rawContent.length > 500) {
      throw new ApiError(
        "Comment must be between 1 and 500 characters",
        400,
        ErrorCodes.VALIDATION_ERROR
      )
    }

    // SECURITY FIX: Sanitize comment content to prevent XSS
    const content = sanitizeInput(rawContent, 500)

    if (!content) {
      throw new ApiError(
        "Comment content is empty after sanitization",
        400,
        ErrorCodes.VALIDATION_ERROR
      )
    }

    // Verify activity exists
    const activity = await prisma.activity.findUnique({ where: { id: activityId } })
    if (!activity) throw new ApiError("Activity not found", 404, ErrorCodes.NOT_FOUND)

    const comment = await prisma.activityComment.create({
      data: { activity_id: activityId, user_id: user.id, content },
      include: {
        user: {
          select: { id: true, username: true, avatar_url: true },
        },
      },
    })

    const commentCount = await prisma.activityComment.count({
      where: { activity_id: activityId },
    })

    return NextResponse.json({ comment, comment_count: commentCount }, { status: 201 })
  } catch (error: unknown) {
    return handleApiError(error)
  }
}
