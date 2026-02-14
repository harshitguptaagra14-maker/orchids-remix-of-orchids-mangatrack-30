"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className={`size-9 rounded-xl ${className}`} disabled>
        <Sun className="size-4" />
      </Button>
    )
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className={`size-9 rounded-xl ${className}`}
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      {theme === "dark" ? (
        <Sun className="size-4 text-yellow-500" />
      ) : (
        <Moon className="size-4 text-zinc-600" />
      )}
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
