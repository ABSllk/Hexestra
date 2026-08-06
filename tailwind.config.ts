import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Semantic colors are CSS channels so opacity utilities work in both themes.
        bg: {
          primary: 'rgb(var(--color-bg-primary) / <alpha-value>)',
          secondary: 'rgb(var(--color-bg-secondary) / <alpha-value>)',
          tertiary: 'rgb(var(--color-bg-tertiary) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'rgb(var(--color-surface) / <alpha-value>)',
          hover: 'rgb(var(--color-surface-hover) / <alpha-value>)',
          active: 'rgb(var(--color-surface-active) / <alpha-value>)',
          light: 'rgb(var(--color-surface-light) / <alpha-value>)',
        },
        text: {
          primary: 'rgb(var(--color-text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--color-text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--color-text-muted) / <alpha-value>)',
        },
        accent: {
          blue: 'rgb(var(--color-accent-blue) / <alpha-value>)',
          green: 'rgb(var(--color-accent-green) / <alpha-value>)',
          red: 'rgb(var(--color-accent-red) / <alpha-value>)',
          yellow: 'rgb(var(--color-accent-yellow) / <alpha-value>)',
          purple: 'rgb(var(--color-accent-purple) / <alpha-value>)',
          teal: 'rgb(var(--color-accent-teal) / <alpha-value>)',
        },
        severity: {
          critical: 'rgb(var(--color-severity-critical) / <alpha-value>)',
          high: 'rgb(var(--color-severity-high) / <alpha-value>)',
          medium: 'rgb(var(--color-severity-medium) / <alpha-value>)',
          low: 'rgb(var(--color-severity-low) / <alpha-value>)',
          info: 'rgb(var(--color-severity-info) / <alpha-value>)',
        },
        node: {
          untested: 'rgb(var(--color-node-untested) / <alpha-value>)',
          progress: 'rgb(var(--color-node-progress) / <alpha-value>)',
          scanned: 'rgb(var(--color-node-scanned) / <alpha-value>)',
          vulnerable: 'rgb(var(--color-node-vulnerable) / <alpha-value>)',
          compromised: 'rgb(var(--color-node-compromised) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['var(--font-ui)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        DEFAULT: '6px',
      },
    },
  },
  plugins: [],
} satisfies Config;
