import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' -> relative asset paths so dist/ works from any subdirectory
// (embedded via <iframe src="journey3d/dist/index.html"> and served by GitHub Pages).
export default defineConfig({
  plugins: [react()],
  base: './',
})
