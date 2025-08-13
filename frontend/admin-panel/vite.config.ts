import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import WindiCSS from 'vite-plugin-windicss'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    WindiCSS(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'safari-pinned-tab.svg'],
      manifest: {
        name: 'AI Answer Ninja Admin Panel',
        short_name: 'AI Ninja Admin',
        description: 'AI电话应答系统管理面板',
        theme_color: '#1890ff',
        background_color: '#ffffff',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\./i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 // 24 hours
              },
              cacheKeyWillBeUsed: async ({ request }) => {
                return `${request.url}?v=${Date.now()}`
              }
            }
          }
        ]
      }
    }),
    visualizer({
      filename: 'dist/stats.html',
      open: true,
      gzipSize: true
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/components': path.resolve(__dirname, './src/components'),
      '@/pages': path.resolve(__dirname, './src/pages'),
      '@/hooks': path.resolve(__dirname, './src/hooks'),
      '@/store': path.resolve(__dirname, './src/store'),
      '@/services': path.resolve(__dirname, './src/services'),
      '@/types': path.resolve(__dirname, './src/types'),
      '@/utils': path.resolve(__dirname, './src/utils'),
      '@/assets': path.resolve(__dirname, './src/assets'),
      '@/styles': path.resolve(__dirname, './src/styles'),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@import "@/styles/themes.scss";`
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: 3100,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV === 'development',
    minify: 'terser',
    target: 'esnext',
    cssCodeSplit: true,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 1000,
    terserOptions: {
      compress: {
        drop_console: process.env.NODE_ENV === 'production',
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.debug']
      }
    },
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Vendor chunks
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) {
              return 'react-vendor'
            }
            if (id.includes('antd') || id.includes('@ant-design')) {
              return 'ui-vendor'
            }
            if (id.includes('echarts') || id.includes('recharts')) {
              return 'chart-vendor'
            }
            if (id.includes('framer-motion')) {
              return 'animation-vendor'
            }
            if (id.includes('dayjs') || id.includes('lodash') || id.includes('axios') || id.includes('socket.io')) {
              return 'utils-vendor'
            }
            if (id.includes('zustand') || id.includes('@tanstack/react-query')) {
              return 'state-vendor'
            }
            return 'vendor'
          }
          
          // App chunks by feature
          if (id.includes('/pages/')) {
            const pageName = id.split('/pages/')[1].split('/')[0]
            return `page-${pageName}`
          }
          
          if (id.includes('/components/')) {
            if (id.includes('/components/ui/')) {
              return 'ui-components'
            }
            if (id.includes('/components/common/')) {
              return 'common-components'
            }
            return 'components'
          }
          
          if (id.includes('/hooks/') || id.includes('/utils/')) {
            return 'shared-utils'
          }
          
          if (id.includes('/store/')) {
            return 'store'
          }
        },
        chunkFileNames: (chunkInfo) => {
          const facadeModuleId = chunkInfo.facadeModuleId
          ? chunkInfo.facadeModuleId.split('/').pop()?.replace('.tsx', '').replace('.ts', '')
          : 'chunk'
          return `assets/${facadeModuleId || chunkInfo.name}-[hash].js`
        },
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name || 'asset'
          const extType = name.split('.').pop() || ''
          
          if (['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp', 'ico'].includes(extType)) {
            return `assets/images/[name]-[hash][extname]`
          }
          if (['woff', 'woff2', 'eot', 'ttf', 'otf'].includes(extType)) {
            return `assets/fonts/[name]-[hash][extname]`
          }
          if (extType === 'css') {
            return `assets/styles/[name]-[hash][extname]`
          }
          return `assets/[name]-[hash][extname]`
        }
      },
      external: (id) => {
        // Mark CDN dependencies as external if using CDN
        if (process.env.VITE_USE_CDN === 'true') {
          return ['react', 'react-dom', 'antd'].some(dep => id.includes(dep))
        }
        return false
      }
    },
  },
  // Performance optimizations
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      'antd',
      '@ant-design/icons',
      'dayjs',
      'lodash-es',
      'axios',
      'zustand',
      '@tanstack/react-query',
      'socket.io-client'
    ],
    exclude: ['@vite/client', '@vite/env']
  },
})