/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // DAWN palette — deep space blues with cyan/violet neural accents.
        bg: '#070b14',
        panel: '#0e1525',
        panel2: '#141d31',
        border: '#1f2b45',
        ink: '#e6ecf7',
        dim: '#94a3b8',
        faint: '#5b6982',
        neural: {
          cyan: '#38bdf8',
          teal: '#2dd4bf',
          violet: '#a855f7',
          amber: '#f59e0b',
          green: '#34d399',
          red: '#ef4444',
          blue: '#60a5fa',
        },
      },
      fontFamily: {
        sans: ['Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['Cascadia Code', 'Consolas', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 40px -8px rgba(56,189,248,0.5)',
        panel: '0 20px 50px -12px rgba(0,0,0,0.55)',
        hud: '0 0 0 1px rgba(56,189,248,0.10), 0 12px 40px -16px rgba(0,0,0,0.7)',
      },
      keyframes: {
        pulseSoft: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.45' } },
        floaty: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-4px)' } },
        scanline: { '0%': { transform: 'translateY(-100%)' }, '100%': { transform: 'translateY(100vh)' } },
        sweep: { '0%': { transform: 'translateX(-120%)' }, '100%': { transform: 'translateX(120%)' } },
        flicker: { '0%,100%': { opacity: '1' }, '47%': { opacity: '0.82' }, '50%': { opacity: '0.4' }, '53%': { opacity: '0.9' } },
        spinSlow: { to: { transform: 'rotate(360deg)' } },
        spinRev: { to: { transform: 'rotate(-360deg)' } },
        breathe: { '0%,100%': { opacity: '0.55', transform: 'scale(1)' }, '50%': { opacity: '1', transform: 'scale(1.04)' } },
        dash: { to: { 'stroke-dashoffset': '-1000' } },
        bootIn: { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: {
        pulseSoft: 'pulseSoft 1.4s ease-in-out infinite',
        floaty: 'floaty 4s ease-in-out infinite',
        scanline: 'scanline 7s linear infinite',
        sweep: 'sweep 3.5s ease-in-out infinite',
        flicker: 'flicker 4s steps(1) infinite',
        spinSlow: 'spinSlow 14s linear infinite',
        spinRev: 'spinRev 22s linear infinite',
        breathe: 'breathe 3s ease-in-out infinite',
        bootIn: 'bootIn 0.4s ease-out both',
      },
    },
  },
  plugins: [],
};
