"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ArrowLeft, Loader2, Send, Heart, MessageSquare } from "lucide-react"
import { toast } from "sonner"

interface Comment {
  id: string
  content: string
  created_at: string
  user: {
    id: string
    username: string
    avatar_url: string | null
  }
}

interface Activity {
  id: string
  type: string
  created_at: string
  like_count: number
  comment_count: number
  liked_by_viewer: boolean
  user?: {
    id: string
    username: string
    avatar_url: string | null
  }
  series?: {
    id: string
    title: string
    cover_url: string | null
  }
  metadata?: Record<string, unknown> | null
}

function CommentSkeleton() {
  return (
    <div className="space-y-4">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-8 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function CommentsPage() {
  const params = useParams()
  const activityId = params.activityId as string

  const [comments, setComments] = useState<Comment[]>([])
  const [activity, setActivity] = useState<Activity | null>(null)
  const [loading, setLoading] = useState(true)
  const [posting, setPosting] = useState(false)
  const [content, setContent] = useState("")
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const fetchComments = useCallback(async (reset = false) => {
    if (!reset) setLoadingMore(true)
    try {
      const params = new URLSearchParams({ limit: "20" })
      if (!reset && cursor) params.set("cursor", cursor)

      const res = await fetch(`/api/feed/activities/${activityId}/comments?${params}`)
      if (res.ok) {
        const data = await res.json()
        if (reset) {
          setComments(data.comments || [])
        } else {
          setComments(prev => [...prev, ...(data.comments || [])])
        }
        setCursor(data.next_cursor || null)
        setHasMore(!!data.next_cursor)
      }
    } catch {
      toast.error("Failed to load comments")
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [activityId, cursor])

  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch(`/api/feed?limit=1&activity_id=${activityId}`)
      if (res.ok) {
        const data = await res.json()
        if (data.activities?.[0]) {
          setActivity(data.activities[0])
        }
      }
    } catch {
      // Activity fetch is non-critical
    }
  }, [activityId])

  useEffect(() => {
    fetchComments(true)
    fetchActivity()
  }, [activityId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!content.trim() || posting) return

    setPosting(true)
    try {
      const res = await fetch(`/api/feed/activities/${activityId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim() }),
      })
      if (res.ok) {
        const data = await res.json()
        setComments(prev => [data.comment, ...prev])
        setContent("")
        toast.success("Comment posted")
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || "Failed to post comment")
      }
    } catch {
      toast.error("Something went wrong")
    } finally {
      setPosting(false)
    }
  }

  const formatTime = (date: string) => {
    const d = new Date(date)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return "just now"
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d ago`
    return d.toLocaleDateString()
  }

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 pb-24 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/feed">
          <Button variant="ghost" size="icon" className="rounded-full size-10">
            <ArrowLeft className="size-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold">Comments</h1>
          {activity && (
            <p className="text-sm text-zinc-500">
              {activity.comment_count} comment{activity.comment_count !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      </div>

      {/* Activity context */}
      {activity?.series && (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800">
          {activity.series.cover_url && (
            <img
              src={activity.series.cover_url}
              alt=""
              className="size-12 rounded-xl object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{activity.series.title}</p>
            <p className="text-xs text-zinc-500">
              by @{activity.user?.username}
            </p>
          </div>
          <div className="flex items-center gap-3 text-zinc-400 text-xs">
            <span className="flex items-center gap-1">
              <Heart className={`size-3.5 ${activity.liked_by_viewer ? "fill-red-500 text-red-500" : ""}`} />
              {activity.like_count}
            </span>
            <span className="flex items-center gap-1">
              <MessageSquare className="size-3.5" />
              {activity.comment_count}
            </span>
          </div>
        </div>
      )}

      {/* Comment input */}
      <form onSubmit={handlePost} className="flex gap-3 items-end">
        <textarea
          ref={inputRef}
          value={content}
          onChange={(e) => setContent(e.target.value.slice(0, 500))}
          placeholder="Write a comment..."
          rows={2}
          className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <Button
          type="submit"
          disabled={!content.trim() || posting}
          size="icon"
          className="rounded-xl size-11 shrink-0"
        >
          {posting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </form>
      <p className="text-xs text-zinc-400 text-right">{content.length}/500</p>

      {/* Comments list */}
      {loading ? (
        <CommentSkeleton />
      ) : comments.length > 0 ? (
        <div className="space-y-4">
          {comments.map((comment) => (
            <div key={comment.id} className="flex gap-3 group">
              <Link href={`/users/${comment.user.username}`} className="shrink-0">
                <div className="size-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center overflow-hidden">
                  {comment.user.avatar_url ? (
                    <img src={comment.user.avatar_url} className="size-full object-cover" alt="" />
                  ) : (
                    <span className="text-xs font-bold text-zinc-400">
                      {comment.user.username[0].toUpperCase()}
                    </span>
                  )}
                </div>
              </Link>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <Link href={`/users/${comment.user.username}`} className="text-sm font-semibold hover:underline">
                    {comment.user.username}
                  </Link>
                  <span className="text-xs text-zinc-400">{formatTime(comment.created_at)}</span>
                </div>
                <p className="text-sm text-zinc-700 dark:text-zinc-300 mt-0.5 break-words">
                  {comment.content}
                </p>
              </div>
            </div>
          ))}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchComments(false)}
                disabled={loadingMore}
                className="rounded-full text-xs"
              >
                {loadingMore ? <Loader2 className="size-4 animate-spin mr-1" /> : null}
                Load more
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-12 text-zinc-500">
          <MessageSquare className="size-10 mx-auto mb-3 text-zinc-300" />
          <p className="text-sm">No comments yet. Be the first!</p>
        </div>
      )}
    </div>
  )
}
