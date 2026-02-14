import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "./app-sidebar"
import { Separator } from "@/components/ui/separator"
import { SafeBrowsingIndicator } from "./safe-browsing-indicator"
import { MobileTabBar } from "./mobile-tab-bar"
import { DynamicBreadcrumb } from "./dynamic-breadcrumb"

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/50 px-4 bg-background/80 backdrop-blur-md sticky top-0 z-40">
          <SidebarTrigger className="-ml-1 hidden md:flex" />
          <Separator orientation="vertical" className="mr-2 h-4 hidden md:block" />
          <DynamicBreadcrumb />
          <div className="ml-auto">
            <SafeBrowsingIndicator />
          </div>
        </header>
        {/* Use div instead of main to avoid nested <main> tags - SidebarInset already renders <main> */}
        <div className="flex-1 overflow-auto bg-background pb-16 md:pb-0">
          {children}
        </div>
        <MobileTabBar />
      </SidebarInset>
    </SidebarProvider>
  )
}
