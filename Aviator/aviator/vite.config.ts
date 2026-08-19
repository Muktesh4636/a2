import { defineConfig } from 'vite'

export default defineConfig({
  base: '/aviator/',
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api/aviator': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/aviator', '/api'),
      },
      '/api/auth': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
})
