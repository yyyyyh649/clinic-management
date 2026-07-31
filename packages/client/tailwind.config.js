/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#eef6ff', 100: '#d9eaff', 500: '#2563eb', 600: '#1d4ed8', 700: '#1e40af' },
        ink: { 900: '#0f172a', 700: '#334155', 500: '#64748b', 300: '#cbd5e1' },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
