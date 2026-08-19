import { defineConfig } from 'vite'

export default defineConfig({
  base: '/shark-bite/',
  server: {
    host: '127.0.0.1',
    port: 5180,
    proxy: {
      '/api/shark-bite': {
        target: 'http://127.0.0.1:8008',
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/shark-bite', '/api'),
      },
      '/api/auth': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
})
