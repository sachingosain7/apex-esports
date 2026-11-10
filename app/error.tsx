"use client";

import { useEffect } from "react";
import { ORG_NAME } from "@/lib/config";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to an error tracking service in production
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-[#06070B] text-white flex flex-col items-center justify-center px-5">
        {/* Ambient glow */}
        <div className="fixed inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-red-500/5 rounded-full blur-3xl" />
        </div>

        <div className="relative z-10 max-w-sm w-full text-center">
          <div className="text-6xl mb-6">⚠️</div>

          <h1 className="text-2xl font-extrabold mb-2">Something went wrong</h1>
          <p className="text-white/50 text-sm mb-6 leading-relaxed">
            An unexpected error occurred. Our team has been notified.
          </p>

          {error.digest && (
            <p className="text-xs text-white/25 font-mono mb-6">
              Error ID: {error.digest}
            </p>
          )}

          <div className="flex flex-col gap-3">
            <button
              onClick={reset}
              className="w-full rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-sm text-black hover:bg-emerald-400 transition-colors"
            >
              Try again
            </button>
            <a
              href="/"
              className="w-full rounded-xl border border-white/15 px-4 py-3 font-semibold text-sm hover:bg-white/5 transition-colors"
            >
              Back to {ORG_NAME}
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
