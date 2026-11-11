import Link from "next/link";
import { ORG_NAME, SUPPORT_WHATSAPP } from "@/lib/config";

export default function NotFound() {
  return (
    <div className="relative min-h-screen bg-[#0A1128] text-white flex flex-col items-center justify-center px-4 py-12 overflow-hidden">
      {/* Subtle modern grid */}
      <div className="fixed inset-0 pointer-events-none hero-grid opacity-30" aria-hidden="true" />
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-md w-full text-center">
        {/* Large 404 */}
        <p className="text-[7rem] sm:text-[9rem] font-black leading-none tracking-tighter text-white/10 select-none">
          404
        </p>

        <div className="-mt-6 sm:-mt-10 bg-white/5 border border-white/10 rounded-3xl p-8 backdrop-blur-md shadow-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3.5 py-1 text-xs text-amber-300 font-bold mb-4">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            Lobby Not Found
          </div>

          <h1 className="text-xl sm:text-2xl font-black mb-2 text-white">
            This tournament doesn&apos;t exist
          </h1>
          <p className="text-slate-300 text-xs sm:text-sm leading-relaxed mb-6">
            The match link may have expired, the lobby may have completed, or the URL might be incorrect.
          </p>

          <div className="flex flex-col gap-2.5">
            <Link
              href="/"
              className="w-full py-3 rounded-xl bg-[#FFB800] hover:bg-[#F59E0B] font-black text-xs sm:text-sm text-slate-950 transition-colors shadow-md text-center"
            >
              Browse Open Lobbies →
            </Link>
            <Link
              href="/my-tournaments"
              className="w-full py-3 rounded-xl border border-white/20 hover:bg-white/10 font-bold text-xs sm:text-sm text-white transition-colors text-center"
            >
              Check My 3-Match IDPs
            </Link>
          </div>

          <p className="mt-6 text-xs text-slate-400">
            {ORG_NAME} · Questions?{" "}
            <a
              href={`https://wa.me/91${SUPPORT_WHATSAPP}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#FFB800] hover:underline font-bold"
            >
              WhatsApp Support
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
