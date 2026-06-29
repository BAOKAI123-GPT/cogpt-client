/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1c1d22',
        panel: '#23242b',
        edge: '#33343d',
        brand: '#8b5cff',
        brand2: '#b06cff'
      }
    }
  },
  plugins: []
}
