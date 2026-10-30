import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = { '@shared': resolve(import.meta.dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      rolldownOptions: { external: ['node:sqlite', 'koffi'] }
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
    plugins: [react()],
    build: {
      // The app window and the player's overlay window.
      rolldownOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/renderer/index.html'),
          overlay: resolve(import.meta.dirname, 'src/renderer/overlay.html')
        }
      }
    }
  }
})
