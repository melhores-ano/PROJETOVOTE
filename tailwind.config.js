/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#070f1e',
          900: '#0a1628',
          850: '#0d1d33',
          800: '#12263f',
          700: '#1a3354',
          600: '#25466f',
          100: '#dbe4f0',
          50: '#eef3f9',
        },
        gold: {
          700: '#8a6d14',
          600: '#a98818',
          500: '#c9a227',
          400: '#d9b545',
          300: '#e5c76a',
          200: '#f0d998',
          100: '#f8ecc8',
          50: '#fdf8e7',
        },
        cream: '#faf7ef',
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'award': '0 20px 60px -15px rgba(201, 162, 39, 0.25)',
        'card': '0 10px 40px -12px rgba(7, 15, 30, 0.35)',
        'gold-glow': '0 0 40px rgba(201, 162, 39, 0.35)',
      },
      backgroundImage: {
        'hero-radial': 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(201,162,39,0.18), transparent)',
        'gold-gradient': 'linear-gradient(135deg, #8a6d14 0%, #c9a227 35%, #e5c76a 50%, #c9a227 65%, #8a6d14 100%)',
      },
      animation: {
        'fade-up': 'fadeUp 0.7s ease-out both',
        'shimmer': 'shimmer 3s linear infinite',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
};
