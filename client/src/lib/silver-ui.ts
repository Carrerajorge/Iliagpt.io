import { cn } from "@/lib/utils";

// Centralized, tiny "silver minimal" primitives used by the chat composer.
// Keep these as simple class strings so components stay flexible.

export const SILVER_HAIRLINE = "border-[0.5px] border-solid";
export const SILVER_HAIRLINE_DASHED = "border-[0.5px] border-dashed";

export const SILVER_BORDER_STRONG = "border-[#c7c7c7]/70 dark:border-white/20";
export const SILVER_BORDER_SOFT = "border-[#c7c7c7]/55 dark:border-white/10";
export const SILVER_BORDER_INNER = "border-[#c7c7c7]/80 dark:border-white/20";
export const SILVER_BORDER_DIVIDER = "border-[#c7c7c7]/35 dark:border-white/10";

export const SILVER_HOVER_BORDER_SOFT = "hover:border-[#bdbdbd]/70 dark:hover:border-white/15";
export const SILVER_HOVER_BORDER_INNER = "hover:border-[#bdbdbd]/85 dark:hover:border-white/25";

export const SILVER_GLASS_BG = "bg-white/70 dark:bg-zinc-900/70 backdrop-blur-xl";

export const SILVER_RING_SOFT = "ring-[#c7c7c7]/35 dark:ring-white/12";

export const SILVER_FOCUS_RING = cn(
  "focus-visible:ring-0",
  "focus-visible:shadow-[0_0_0_1px_rgba(199,199,199,0.35)]",
  "dark:focus-visible:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
);

export const SILVER_CONTAINER_FOCUS = cn(
  "focus-within:shadow-[0_0_0_1px_rgba(199,199,199,0.28),0_10px_30px_rgba(0,0,0,0.05)]",
  "focus-within:border-[#bdbdbd]/80",
  "dark:focus-within:shadow-[0_0_0_1px_rgba(255,255,255,0.10),0_10px_30px_rgba(0,0,0,0.25)]",
  "dark:focus-within:border-white/20"
);

export const SILVER_CONTAINER_SHADOW = cn(
  "shadow-[0_10px_30px_rgba(0,0,0,0.03)]",
  "hover:shadow-[0_10px_30px_rgba(0,0,0,0.05)]"
);

export const SILVER_KBD = cn(
  SILVER_HAIRLINE,
  "border-[#c7c7c7]/45 dark:border-white/12",
  "bg-white/30 dark:bg-white/5",
  "text-zinc-600 dark:text-white/60",
  "rounded-md px-1 py-0.5 text-[9px] font-mono"
);

export const SILVER_ICON_BUTTON_BASE = cn(
  "rounded-full",
  "backdrop-blur-sm shadow-none",
  "transition-colors duration-150",
  SILVER_HAIRLINE,
  SILVER_FOCUS_RING
);

export const SILVER_ICON_BUTTON_TONE = cn(
  SILVER_BORDER_STRONG,
  "bg-white/35 hover:bg-white/55 dark:bg-white/5 dark:hover:bg-white/8",
  "text-zinc-700 hover:text-zinc-900 dark:text-white/70 dark:hover:text-white/90"
);

export const SILVER_ICON_BUTTON_DISABLED_TONE = cn(
  "opacity-50 cursor-not-allowed",
  "bg-white/20 dark:bg-white/5",
  "border-[#c7c7c7]/40 dark:border-white/10",
  "text-zinc-400 dark:text-white/30"
);

export const SILVER_ICON_BUTTON_DANGER_TONE = cn(
  "border-[#c7c7c7]/70 hover:border-red-400 dark:border-white/20 dark:hover:border-red-300/40",
  "bg-white/35 hover:bg-red-50 dark:bg-white/5 dark:hover:bg-red-950/30",
  "text-zinc-700 hover:text-red-600 dark:text-white/70 dark:hover:text-red-300"
);
