"use client";

import { useEffect } from "react";
import { ORG_NAME, SUPPORT_WHATSAPP } from "@/lib/config";
import Link from "next/link";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Apex Error]", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[#0A1128] text-white flex flex-col items-center justify-center px-4 py-12 relative overflow-hidden">
      {/* Background Glow */}
      <div className="absolute inset-0 pointer-events-none hero-grid opacity-30" />
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-md w-full bg-white/5 border border-white/10 rounded-3xl p-8 sm:p-10 text-center backdrop-blur-md shadow-2xl">
        <div className="w-16 h-16 rounded-2xl bg-amber-400/20 text-[#FFB800] text-3xl flex items-center justify-center mx-auto mb-5 font-black">
          ⚠️
        </div>

        <h1 className="text-xl sm:text-2xl font-black text-white mb-2">
          Something went wrong
        </h1>
        <p className="text-slate-300 text-xs sm:text-sm mb-6 leading-relaxed">
          An unexpected glitch occurred while loading this tournament view. Your data is safe.
        </p>

        {error.digest && (
          <p className="text-[11px] text-slate-400 font-mono mb-6 bg-white/5 py-1 px-3 rounded-lg border border-white/10 inline-block">
            Reference ID: {error.digest}
          </p>
        )}

        <div className="flex flex-col gap-3">
          <button
            onClick={reset}
            className="w-full py-3 rounded-xl bg-[#FFB800] hover:bg-[#F59E0B] text-slate-950 font-black text-xs sm:text-sm transition-all shadow-md cursor-pointer"
          >
            Try Again 🔄
          </button>
          <Link
            href="/"
            className="w-full py-3 rounded-xl border border-white/20 hover:bg-white/10 text-white font-bold text-xs sm:text-sm transition-colors text-center"
          >
            Return to {ORG_NAME} Public Lobbies
          </Link>
          <a
            href={`https://wa.me/91${SUPPORT_WHATSAPP}?text=Hi+Host,+I+encountered+an+error+on+the+website.`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold pt-2"
          >
            Need help? Contact Host on WhatsApp 💬
          </a>
        </div>
      </div>
    </div>
  );
}
