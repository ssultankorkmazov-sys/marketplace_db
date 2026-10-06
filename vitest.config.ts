import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Tests only: the production build config stays in vite.config.ts (GitHub Pages base untouched).
export default defineConfig({
    plugins: [react()],
    test: { environment: 'jsdom', include: ['tests/**/*.test.{ts,tsx}'] },
})
