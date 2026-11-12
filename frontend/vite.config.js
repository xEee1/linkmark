import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 开发期把 /api 代理到本地后端（生产由镜像内置 nginx 反代，前后端同源）
      '/api': 'http://localhost:3000',
    },
  },
});
