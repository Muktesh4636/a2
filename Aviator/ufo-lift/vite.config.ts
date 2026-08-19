import { defineConfig } from 'vite'

export default defineConfig({
  base: '/ufo-lift/',
  server: {
    host: '127.0.0.1',
    port: 5179,
    proxy: {
      '/api/ufo-lift': {
        target: 'http://127.0.0.1:8007',
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/ufo-lift', '/api'),
      },
      '/api/auth': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
})
