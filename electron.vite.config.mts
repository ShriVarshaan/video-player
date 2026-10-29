import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = { '@shared': resolve(import.meta.dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      rolldownOptions: { external: ['node:sqlite'] }
    }
  },
  preload: {
    resolve: { alias },
    build: {
      // Sandboxed preloads can't load ES modules.
      rolldownOptions: { output: { format: 'cjs' } }
    }
  },
  renderer: {
    resolve: { alias },
    plugins: [react()]
  }
})
