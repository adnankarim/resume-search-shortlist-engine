import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    server: {
        host: true, // Needed for Docker
        port: 3000,
        proxy: {
            '/api': {
                target: process.env.PROXY_TARGET || 'http://localhost:3001',
                changeOrigin: true,
            },
        },
    },
})
