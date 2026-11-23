import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: { manualChunks: (id) => id.includes('/node_modules/zrender/') ? 'chart-renderer' : undefined },
    },
  },
  server: {
    host: '127.0.0.1',
    proxy: { '/api': process.env.ECONOMIND_API_TARGET ?? 'http://127.0.0.1:8000' },
  },
})
