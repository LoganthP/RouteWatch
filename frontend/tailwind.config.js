/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // Light-only interface by design: no dark variant is generated.
  darkMode: 'class', // the .dark class is never applied
  theme: {
    extend: {
      colors: {
        sky: { DEFAULT: '#2E9BFF', soft: '#DCEEFF', deep: '#1677E0' },
        sun: { DEFAULT: '#FFC93C', soft: '#FFF3CC', deep: '#E8A800' },
        coral: { DEFAULT: '#FF4D6D', soft: '#FFE1E7' },
        tangerine: { DEFAULT: '#FF8A3D', soft: '#FFE8D6' },
        mint: { DEFAULT: '#2BD9A6', soft: '#D7F8EE', deep: '#13A87C' },
        lilac: { DEFAULT: '#9B8CFF', soft: '#ECE8FF' },
        ink: { DEFAULT: '#1E2A44', soft: '#5B6B8C', faint: '#8F9BB5' },
        cloud: '#F3F8FF',
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Manrope', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glass: '0 1px 0 rgba(255,255,255,.9) inset, 0 18px 40px -18px rgba(46,95,170,.28)',
        lift: '0 1px 0 rgba(255,255,255,.9) inset, 0 28px 60px -20px rgba(46,95,170,.38)',
        clay: '0 12px 22px -10px rgba(22,119,224,.6), inset 0 -4px 0 rgba(0,0,0,.12), inset 0 3px 0 rgba(255,255,255,.45)',
        'clay-sun': '0 12px 22px -10px rgba(232,168,0,.55), inset 0 -4px 0 rgba(0,0,0,.08), inset 0 3px 0 rgba(255,255,255,.6)',
        'clay-white': '0 10px 20px -12px rgba(46,95,170,.45), inset 0 -3px 0 rgba(46,95,170,.08), inset 0 2px 0 #fff',
        neu: '6px 6px 14px #d2dcec, -6px -6px 14px #ffffff',
        'neu-in': 'inset 4px 4px 9px #d2dcec, inset -4px -4px 9px #ffffff',
      },
      borderRadius: { '4xl': '2rem' },
      keyframes: {
        drift: {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '50%': { transform: 'translate(40px,-30px) scale(1.08)' },
        },
      },
      animation: { drift: 'drift 22s ease-in-out infinite' },
    },
  },
  plugins: [],
};
