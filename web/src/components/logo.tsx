import { cn } from "@/lib/utils";

/** Isometric block mark (same artwork as the favicon). */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("shrink-0", className)} aria-hidden>
      <rect width="32" height="32" rx="7" className="fill-secondary" />
      <path
        d="M8 11.5 16 7l8 4.5v9L16 25l-8-4.5zM8 11.5 16 16l8-4.5M16 16v9"
        fill="none"
        className="stroke-live"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
