import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/dice-over-under/',
  plugins: [react()],
  server: {
    port: 5179,
    proxy: {
      '/api/dice-over-under': {
        target: 'http://127.0.0.1:8005',
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/dice-over-under', '/api'),
      },
      '/api/auth': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
})
