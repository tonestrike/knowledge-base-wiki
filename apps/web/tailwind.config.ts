import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '2rem', screens: { '2xl': '1400px' } },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        verdict: {
          supported: 'hsl(var(--verdict-supported))',
          unsupported: 'hsl(var(--verdict-unsupported))',
          contradicted: 'hsl(var(--verdict-contradicted))',
        },
      },
      fontFamily: {
        serif: ['"Crimson Pro"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      maxWidth: { prose: '60ch', sidebar: '280px' },
      transitionDuration: {
        DEFAULT: '200ms',
        flight: '400ms',
        card: '600ms',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        'flight-spring': 'cubic-bezier(0.7, 0, 0.3, 0.9)',
      },
      keyframes: {
        shimmer: {
          '0%, 100%': { 'text-decoration-color': 'transparent' },
          '50%': { 'text-decoration-color': 'hsl(var(--accent))' },
        },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        shimmer: 'shimmer 1.4s ease-in-out',
        'fade-in': 'fade-in 200ms ease-out',
      },
    },
  },
  plugins: [animate],
};

export default config;
