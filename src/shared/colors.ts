import { createContext, useContext } from "react";
import type { SessionKind } from "./types.js";

export type ThemePalette = {
  primary: string | undefined;
  secondary: string | undefined;
  accent: string | undefined;
  success: string | undefined;
  warning: string | undefined;
  error: string | undefined;
  dim: string | undefined;
  muted: string | undefined;
  border: string | undefined;
  codeBg?: string;
  badgeBg?: string;
  badgeText?: string;
};

export const GlobalColors = {
  default: {
    primary: "#38BDF8",     // sky blue
    secondary: "#59E6A7",   // emerald / mint
    accent: "#818CF8",      // indigo
    success: "#34D399",     // green
    warning: "#FBBF24",     // amber
    error: "#F87171",       // red
    dim: "#64748B",         // slate 500
    muted: "#94A3B8",       // slate 400
    border: "#334155",      // slate 700
    codeBg: "#1E293B",
    badgeBg: "#0369A1",
    badgeText: "#E0F2FE",
  } satisfies ThemePalette,

  planning: {
    primary: "#C084FC",     // purple 400
    secondary: "#E879F9",   // fuchsia 400
    accent: "#A855F7",      // purple 500
    success: "#34D399",     // green
    warning: "#FBBF24",     // amber
    error: "#F87171",       // red
    dim: "#7E22CE",         // purple 700
    muted: "#D8B4FE",       // purple 300
    border: "#6B21A8",      // purple 800
    codeBg: "#1E293B",
    badgeBg: "#581C87",     // purple 900
    badgeText: "#F3E8FF",   // purple 100
  } satisfies ThemePalette,
};

export const COLOR_SCHEMES = ["default", "ocean", "warm", "forest", "rose", "violet", "amber", "slate", "mono"] as const;
export type ColorScheme = typeof COLOR_SCHEMES[number];
export const ColorSchemeContext = createContext<ColorScheme>("default");

export function getTheme(kind?: SessionKind, scheme: ColorScheme = "default"): ThemePalette {
  const base = kind === "planning" ? GlobalColors.planning : GlobalColors.default;
  if (scheme === "mono") return { primary: undefined, secondary: undefined, accent: undefined, success: undefined, warning: undefined, error: undefined, dim: undefined, muted: undefined, border: undefined };
  if (scheme === "ocean") return { ...base, primary: "#22D3EE", secondary: "#60A5FA", accent: "#A78BFA", border: "#155E75", badgeBg: "#164E63", badgeText: "#ECFEFF" };
  if (scheme === "warm") return { ...base, primary: "#FDBA74", secondary: "#FCD34D", accent: "#F9A8D4", border: "#78350F", badgeBg: "#7C2D12", badgeText: "#FFF7ED" };
  if (scheme === "forest") return { ...base, primary: "#4ADE80", secondary: "#A3E635", accent: "#2DD4BF", border: "#166534", badgeBg: "#14532D", badgeText: "#F0FDF4" };
  if (scheme === "rose") return { ...base, primary: "#FB7185", secondary: "#F9A8D4", accent: "#E879F9", border: "#9F1239", badgeBg: "#881337", badgeText: "#FFF1F2" };
  if (scheme === "violet") return { ...base, primary: "#A78BFA", secondary: "#C4B5FD", accent: "#F0ABFC", border: "#5B21B6", badgeBg: "#4C1D95", badgeText: "#F5F3FF" };
  if (scheme === "amber") return { ...base, primary: "#FBBF24", secondary: "#FDE68A", accent: "#FB923C", border: "#92400E", badgeBg: "#78350F", badgeText: "#FFFBEB" };
  if (scheme === "slate") return { ...base, primary: "#CBD5E1", secondary: "#E2E8F0", accent: "#93C5FD", border: "#475569", badgeBg: "#334155", badgeText: "#F8FAFC" };
  return base;
}

export function useTheme(kind?: SessionKind): ThemePalette {
  return getTheme(kind, useContext(ColorSchemeContext));
}

export function supportsAnimation(stream: { isTTY?: boolean }, env = process.env, scheme: ColorScheme = "default"): boolean {
  return !!stream.isTTY && env.NO_COLOR === undefined && env.FORCE_COLOR !== "0" && env.TERM !== "dumb" && scheme !== "mono";
}
