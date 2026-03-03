/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./src/**/*.{astro,tsx,ts}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Clash Display', 'system-ui', 'sans-serif'],
        body: ['General Sans', 'system-ui', 'sans-serif'],
      },
      colors: {
        cooked: {
          green: '#4ade80',
          yellow: '#facc15',
          orange: '#fb923c',
          red: '#ef4444',
        },
        surface: {
          DEFAULT: '#0a0a0a',
          raised: '#141414',
          border: '#262626',
        },
        accent: '#f97316',
      },
    },
  },
};
