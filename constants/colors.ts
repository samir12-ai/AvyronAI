const primaryGradientStart = "#6366F1";
const primaryGradientEnd = "#8B5CF6";
const accentTeal = "#14B8A6";
const accentOrange = "#F97316";
const successGreen = "#22C55E";
const warningAmber = "#F59E0B";
const errorRed = "#EF4444";

export default {
  light: {
    text: "#1F2937",
    textSecondary: "#6B7280",
    textMuted: "#9CA3AF",
    background: "#F8FAFC",
    backgroundSecondary: "#FFFFFF",
    card: "#FFFFFF",
    cardBorder: "#E5E7EB",
    primary: primaryGradientStart,
    primaryGradient: [primaryGradientStart, primaryGradientEnd],
    accent: accentTeal,
    accentOrange: accentOrange,
    success: successGreen,
    warning: warningAmber,
    error: errorRed,
    tint: primaryGradientStart,
    tabIconDefault: "#9CA3AF",
    tabIconSelected: primaryGradientStart,
    inputBackground: "#F3F4F6",
    inputBorder: "#D1D5DB",
    divider: "#E5E7EB",
  },
  dark: {
    text: "#F9FAFB",
    textSecondary: "#D1D5DB",
    textMuted: "#9CA3AF",
    background: "#0F172A",
    backgroundSecondary: "#1E293B",
    card: "#1E293B",
    cardBorder: "#334155",
    primary: primaryGradientStart,
    primaryGradient: [primaryGradientStart, primaryGradientEnd],
    accent: accentTeal,
    accentOrange: accentOrange,
    success: successGreen,
    warning: warningAmber,
    error: errorRed,
    tint: primaryGradientStart,
    tabIconDefault: "#64748B",
    tabIconSelected: primaryGradientStart,
    inputBackground: "#334155",
    inputBorder: "#475569",
    divider: "#334155",
  },
};
