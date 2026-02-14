import Link from "next/link"

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#0c0a14] flex flex-col items-center justify-center p-6 text-center">
      <div className="w-20 h-20 rounded-full bg-purple-500/10 flex items-center justify-center mb-6">
        <span className="text-4xl font-bold text-purple-400">404</span>
      </div>

      <h2 className="text-2xl font-bold text-white mb-2">
        Page not found
      </h2>
      <p className="text-white/60 max-w-md mb-8">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>

      <div className="flex items-center gap-4">
        <Link
          href="/"
          className="px-6 py-3 rounded-full bg-purple-600 hover:bg-purple-700 text-white font-medium transition-colors"
        >
          Go Home
        </Link>
        <Link
          href="/library"
          className="px-6 py-3 rounded-full border border-white/20 hover:border-white/40 text-white font-medium transition-colors"
        >
          My Library
        </Link>
      </div>
    </div>
  )
}
