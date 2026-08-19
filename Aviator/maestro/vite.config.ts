import { defineConfig } from 'vite'

export default defineConfig({
  base: '/maestro/',
  server: {
    host: '127.0.0.1',
    port: 5174,
    proxy: {
      '/api/maestro': {
        target: 'http://127.0.0.1:8003',
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/maestro', '/api'),
      },
      '/api/auth': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
})
