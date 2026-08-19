import { defineConfig } from 'vite'

export default defineConfig({
  base: '/sky-lift/',
  server: {
    host: '127.0.0.1',
    port: 5177,
    proxy: {
      '/api/sky-lift': {
        target: 'http://127.0.0.1:8005',
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/sky-lift', '/api'),
      },
      '/api/auth': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
})
