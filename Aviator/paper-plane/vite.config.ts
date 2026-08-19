import { defineConfig } from 'vite'

export default defineConfig({
  base: '/paper-plane/',
  server: {
    host: '127.0.0.1',
    port: 5178,
    proxy: {
      '/api/paper-plane': {
        target: 'http://127.0.0.1:8006',
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/paper-plane', '/api'),
      },
      '/api/auth': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
})
