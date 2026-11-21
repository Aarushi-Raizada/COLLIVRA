import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { RiskCategory, ScreeningCategory } from "@/types/api";

/**
 * Standard Tailwind CSS class merger utility.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Format ISO 8601 UTC timestamp to readable high-precision UTC string.
 */
export function formatUtcDateTime(isoStr: string | null | undefined): string {
  if (!isoStr) return "—";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toISOString().replace("T", " ").replace("Z", " UTC");
  } catch {
    return String(isoStr);
  }
}

/**
 * Format UTC clock time (HH:MM:SS UTC).
 */
export function formatUtcClock(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  return `${hours}:${minutes}:${seconds} UTC`;
}

/**
 * Format distance in kilometers (km).
 */
export function formatDistanceKm(km: number | null | undefined, decimals = 3): string {
  if (km == null || isNaN(km)) return "— km";
  return `${km.toFixed(decimals)} km`;
}

/**
 * Format velocity in kilometers per second (km/s).
 */
export function formatVelocityKms(kms: number | null | undefined, decimals = 3): string {
  if (kms == null || isNaN(kms)) return "— km/s";
  return `${kms.toFixed(decimals)} km/s`;
}

/**
 * Format score [0 - 100].
 */
export function formatScore(score: number | null | undefined, decimals = 1): string {
  if (score == null || isNaN(score)) return "—";
  return score.toFixed(decimals);
}

/**
 * Color and border styling by Risk Category.
 */
export function getRiskCategoryStyles(category: RiskCategory | ScreeningCategory | undefined): {
  text: string;
  bg: string;
  border: string;
  badge: string;
} {
  switch (category) {
    case "CRITICAL":
      return {
        text: "text-rose-400",
        bg: "bg-rose-500/10",
        border: "border-rose-500/30",
        badge: "bg-rose-950/80 text-rose-300 border-rose-700/50",
      };
    case "HIGH":
      return {
        text: "text-amber-400",
        bg: "bg-amber-500/10",
        border: "border-amber-500/30",
        badge: "bg-amber-950/80 text-amber-300 border-amber-700/50",
      };
    case "MODERATE":
      return {
        text: "text-yellow-400",
        bg: "bg-yellow-500/10",
        border: "border-yellow-500/30",
        badge: "bg-yellow-950/80 text-yellow-300 border-yellow-700/50",
      };
    case "LOW":
      return {
        text: "text-blue-400",
        bg: "bg-blue-500/10",
        border: "border-blue-500/30",
        badge: "bg-blue-950/80 text-blue-300 border-blue-700/50",
      };
    case "NEGLIGIBLE":
    default:
      return {
        text: "text-slate-400",
        bg: "bg-slate-500/10",
        border: "border-slate-500/30",
        badge: "bg-slate-900/80 text-slate-300 border-slate-700/50",
      };
  }
}

