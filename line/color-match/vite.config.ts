import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/color-match/',
  plugins: [react()],
  server: {
    port: 5180,
    proxy: {
      '/api/color-match': {
        target: 'http://127.0.0.1:8006',
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/color-match', '/api'),
      },
      '/api/auth': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
})
