export const colors = {
  petroleum: '#0D0D1A',
  petroleumDark: '#050508',
  petroleumLight: '#1A1A2E',
  petroleumMid: '#141428',
  orange: '#e86a24',
  orangeDark: '#c4551a',
  orangeLight: '#ff8a4a',
  orangeSoft: 'rgba(232, 106, 36, 0.10)',
  orangeMuted: 'rgba(232, 106, 36, 0.16)',
  white: '#ffffff',
  gray50: '#f3f5f8',
  gray100: '#e6ebf0',
  gray200: '#cfd6de',
  gray400: '#8b9aab',
  gray600: '#5a6b7d',
  gray800: '#2c3a47',
  danger: '#c62828',
  dangerSoft: 'rgba(198, 40, 40, 0.08)',
  success: '#2e7d32',
  successSoft: 'rgba(46, 125, 50, 0.10)',
  infoSoft: 'rgba(13, 13, 26, 0.06)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  full: 9999,
} as const;

/** Sombras suaves padrão (iOS + Android elevation). */
export const shadows = {
  sm: {
    shadowColor: '#050508',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  md: {
    shadowColor: '#050508',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  lg: {
    shadowColor: '#050508',
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
} as const;
