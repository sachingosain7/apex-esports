"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Legacy single-event register route: /register/[id]
 * Redirects immediately to the new unified checkout: /register?e=[id]
 */
export default function SingleEventRegisterRedirect() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    if (id) {
      router.replace(`/register?e=${id}`);
    }
  }, [id, router]);

  return (
    <div className="min-h-screen bg-[#06070B] flex items-center justify-center">
      <div className="flex items-center gap-3 text-white/40 text-sm">
        <svg
          className="w-5 h-5 animate-spin"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        Redirecting to checkout…
      </div>
    </div>
  );
}
