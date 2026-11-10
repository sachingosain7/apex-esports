import Link from "next/link";
import { ORG_NAME } from "@/lib/config";

export default function NotFound() {
  return (
    <div className="relative min-h-screen bg-[#06070B] text-white flex flex-col items-center justify-center px-5 overflow-hidden">
      {/* Tactical grid */}
      <div className="fixed inset-0 pointer-events-none tactical-grid" aria-hidden="true" />
      {/* Ambient glows */}
      <div className="fixed inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/[0.04] rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-72 h-72 bg-purple-600/[0.04] rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-md w-full text-center">
        {/* Large 404 */}
        <p className="text-[8rem] sm:text-[10rem] font-extrabold leading-none tracking-tighter text-white/[0.04] select-none">
          404
        </p>

        <div className="-mt-8 sm:-mt-12">
          <div className="inline-flex items-center gap-2 rounded-full border border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-400 font-medium mb-5">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
            Lobby not found
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold mb-3">
            This page doesn&apos;t exist
          </h1>
          <p className="text-white/50 text-sm leading-relaxed mb-8">
            The URL might be wrong, the event may have ended, or the link
            is no longer valid.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/"
              className="rounded-xl bg-emerald-500 px-6 py-3 font-semibold text-sm text-black hover:bg-emerald-400 transition-colors"
            >
              Browse open lobbies
            </Link>
            <Link
              href="/my-tournaments"
              className="rounded-xl border border-white/15 px-6 py-3 font-semibold text-sm hover:bg-white/5 transition-colors"
            >
              My tournaments
            </Link>
          </div>
        </div>

        <p className="mt-10 text-xs text-white/20">
          {ORG_NAME} · Need help?{" "}
          <a
            href="/login"
            className="text-emerald-500 hover:text-emerald-400 transition-colors"
          >
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
