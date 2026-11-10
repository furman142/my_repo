/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#05070a',
          900: '#090c11',
          850: '#0c1016',
          800: '#10151d',
          700: '#161d28',
          600: '#1f2836',
          500: '#2b3647',
          400: '#5b687c',
          300: '#8693a6',
          200: '#b4bfcd',
          100: '#e3e9f1',
        },
        signal: {
          DEFAULT: '#3b82f6',
          soft: '#1d3a66',
          glow: '#60a5fa',
        },
        live: '#ef4444',
        warn: '#f59e0b',
        ok: '#22c55e',
      },
      fontFamily: {
        sans: ['"Heebo Variable"', 'Heebo', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        pulseDot: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.35' } },
        fadeIn: { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: {
        pulseDot: 'pulseDot 1.6s ease-in-out infinite',
        fadeIn: 'fadeIn .25s ease-out',
      },
    },
  },
  plugins: [],
};
