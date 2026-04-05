import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/anatomia-agente-ia/',
  server: {
    fs: {
      // Allow importing .md files from parent directory (nucleo/, cartografia/)
      allow: ['..']
    }
  }
})
