import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Hexestra dark theme palette
        bg: {
          primary: '#1e1e2e',
          secondary: '#181825',
          tertiary: '#11111b',
        },
        surface: {
          DEFAULT: '#313244',
          hover: '#45475a',
          active: '#585b70',
        },
        text: {
          primary: '#cdd6f4',
          secondary: '#a6adc8',
          muted: '#6c7086',
        },
        accent: {
          blue: '#89b4fa',
          green: '#a6e3a1',
          red: '#f38ba8',
          yellow: '#f9e2af',
          purple: '#cba6f7',
          teal: '#94e2d5',
        },
        severity: {
          critical: '#f38ba8',
          high: '#fab387',
          medium: '#f9e2af',
          low: '#a6e3a1',
          info: '#89b4fa',
        },
        node: {
          untested: '#6c7086',
          progress: '#89b4fa',
          scanned: '#f9e2af',
          vulnerable: '#fab387',
          compromised: '#a6e3a1',
        },
      },
      fontFamily: {
        sans: ['var(--font-ui)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.75rem' }],
      },
      borderRadius: {
        DEFAULT: '6px',
      },
    },
  },
  plugins: [],
} satisfies Config;
