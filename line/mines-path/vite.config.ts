import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/mines-path/',
  plugins: [react()],
  server: {
    port: 5178,
    proxy: {
      '/api/mines-path': {
        target: 'http://127.0.0.1:8004',
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/mines-path', '/api'),
      },
      '/api/auth': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
})
