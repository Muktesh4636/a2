import { defineConfig } from 'vite'

export default defineConfig({
  base: '/deep-dive/',
  server: {
    host: '127.0.0.1',
    port: 5176,
    proxy: {
      '/api/deep-dive': {
        target: 'http://127.0.0.1:8004',
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/deep-dive', '/api'),
      },
      '/api/auth': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
})
