"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { BookOpen, Compass, Layers, Sparkles, MoreHorizontal } from "lucide-react"
import { useState, useEffect } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Trophy, Users, Bell, Settings, Search } from "lucide-react"

const primaryTabs = [
  { title: "Library", url: "/library", icon: BookOpen },
  { title: "Feed", url: "/feed", icon: Layers },
  { title: "Discover", url: "/discover", icon: Compass },
  { title: "Progress", url: "/progress", icon: Sparkles },
]

const moreTabs = [
  { title: "Browse", url: "/browse", icon: Search },
  { title: "Leaderboard", url: "/leaderboard", icon: Trophy },
  { title: "Friends", url: "/friends", icon: Users },
  { title: "Notifications", url: "/notifications", icon: Bell },
  { title: "Settings", url: "/settings", icon: Settings },
]

export function MobileTabBar() {
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  const isMoreActive = moreTabs.some((tab) => pathname === tab.url || pathname.startsWith(tab.url + "/"))

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-background/80 backdrop-blur-xl border-t border-border pb-safe">
      <div className="flex items-center justify-around h-14">
        {primaryTabs.map((tab) => {
          const isActive = pathname === tab.url || pathname.startsWith(tab.url + "/")
          return (
            <Link
              key={tab.url}
              href={tab.url}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full touch-target transition-colors ${
                isActive
                  ? "text-primary"
                  : "text-muted-foreground"
              }`}
            >
              <tab.icon className={`size-5 ${isActive ? "stroke-[2.5]" : ""}`} />
              <span className="text-[10px] font-medium">{tab.title}</span>
            </Link>
          )
        })}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full touch-target transition-colors ${
                isMoreActive
                  ? "text-primary"
                  : "text-muted-foreground"
              }`}
            >
              <MoreHorizontal className={`size-5 ${isMoreActive ? "stroke-[2.5]" : ""}`} />
              <span className="text-[10px] font-medium">More</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" sideOffset={8} className="w-48 rounded-xl mb-1">
            {moreTabs.map((tab) => (
              <DropdownMenuItem key={tab.url} asChild>
                <Link href={tab.url} className="flex items-center gap-3 cursor-pointer">
                  <tab.icon className="size-4" />
                  <span>{tab.title}</span>
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  )
}
