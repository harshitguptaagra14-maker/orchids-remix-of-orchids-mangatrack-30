"use client"

import { usePathname } from "next/navigation"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

const PAGE_TITLES: Record<string, string> = {
  "/library": "Library",
  "/browse": "Browse",
  "/discover": "Discover",
  "/feed": "Feed",
  "/progress": "Progress",
  "/leaderboard": "Leaderboard",
  "/friends": "Friends",
  "/notifications": "Notifications",
  "/settings": "Settings",
}

export function DynamicBreadcrumb() {
  const pathname = usePathname()

  // Find the matching page title
  const matchedKey = Object.keys(PAGE_TITLES).find(
    (key) => pathname === key || pathname.startsWith(key + "/")
  )
  const pageTitle = matchedKey ? PAGE_TITLES[matchedKey] : "Dashboard"

  // Handle user profile pages
  const isProfilePage = pathname.startsWith("/users/")
  const profileTitle = isProfilePage ? "Profile" : null

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem className="hidden md:block">
          <BreadcrumbLink href="/library">MangaTrack</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator className="hidden md:block" />
        <BreadcrumbItem>
          <BreadcrumbPage>{profileTitle || pageTitle}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}
