export const ShellTheme = {
  colors: {
    appBackground: '#0F131A',
    sidebarSurface: '#161B22',
    border: '#1E2535',
    textPrimary: '#FFFFFF',
    textMuted: '#9CA3AF',
    textDeepMuted: '#6B7280',
    accentPrimary: '#8B5CF6',
    accentHover: '#1E2535',
  },
  spacing: {
    base: 8,
    tight: 12,
    standard: 24,
    loose: 32,
  },
  typography: {
    h1: { fontSize: 28, fontWeight: '700' as const, color: '#FFFFFF' },
    h2: { fontSize: 18, fontWeight: '600' as const, color: '#F9FAFB' },
    body: { fontSize: 15, fontWeight: '400' as const, color: '#E5E7EB' },
    meta: { fontSize: 13, fontWeight: '500' as const, color: '#9CA3AF' },
  }
};
