import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Caminhos relativos: o site funciona no GitHub Pages, que o publica em
  // https://<usuario>.github.io/<repositorio>/, e também no npm run dev
  base: './',
})
