import { defineConfig } from 'vite'

export default defineConfig({
  base: '/jet/',
  server: {
    host: '127.0.0.1',
    port: 5175,
    proxy: {
      '/api/jet': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/jet', '/api'),
      },
      '/api/auth': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
})
