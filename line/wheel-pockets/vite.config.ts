import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/wheel-pockets/',
  plugins: [react()],
  server: {
    port: 5181,
    proxy: {
      '/api/wheel-pockets': {
        target: 'http://127.0.0.1:8007',
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/wheel-pockets', '/api'),
      },
      '/api/auth': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
})
