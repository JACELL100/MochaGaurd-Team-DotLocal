/**
 * MochaGuard Design Tokens - Royal Violet Space Palette
 * Tasteful, non-garish, luxury fintech theme.
 */

export const colors = {
  // Primary: Royal Violet & Deep Amethyst
  primary: {
    DEFAULT: "#7C3AED", // Royal Violet (accent / active)
    hover: "#6D28D9",   // Deep Amethyst hover
    dark: "#4C1D95",    // Imperial Plum press
    light: "#8B5CF6",   // Luminous Violet
    soft: "rgba(124, 58, 237, 0.12)",
    border: "rgba(139, 92, 246, 0.25)",
    glow: "rgba(124, 58, 237, 0.45)",
  },

  // Secondary: Platinum Lilac / Stellar Ice
  secondary: {
    DEFAULT: "#A78BFA",
    hover: "#C4B5FD",
    soft: "rgba(167, 139, 250, 0.1)",
    border: "rgba(196, 181, 253, 0.2)",
  },

  // Space Backgrounds (Obsidian & Void)
  bg: {
    base: "#05050A",      // Pitch black cosmic void
    elevated: "#0B0A14",  // Elevated surface
    card: "#121024",      // Luxury card backdrop
    cardHover: "#181530", // Card hover state
    overlay: "rgba(5, 5, 10, 0.85)",
  },

  // Semantic Accents (Refined & Controlled)
  status: {
    danger: "#EF4444",      // Liquidation / Margin breach
    dangerSoft: "rgba(239, 68, 68, 0.12)",
    dangerGlow: "rgba(239, 68, 68, 0.35)",

    safe: "#10B981",        // Verified / Healthy buffer
    safeSoft: "rgba(16, 185, 129, 0.12)",
    safeGlow: "rgba(16, 185, 129, 0.35)",

    warn: "#F59E0B",        // At-risk / Earnings tonight
    warnSoft: "rgba(245, 158, 11, 0.12)",
    warnGlow: "rgba(245, 158, 11, 0.35)",

    info: "#6366F1",        // Halts / Freeze Guard
    infoSoft: "rgba(99, 102, 241, 0.12)",
    infoGlow: "rgba(99, 102, 241, 0.35)",
  },

  // Text Hierarchy
  text: {
    primary: "#FFFFFF",
    secondary: "#E2E8F0",
    tertiary: "#94A3B8",
    muted: "#64748B",
  },
} as const;
