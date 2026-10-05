import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const configuredApiUrl = loadEnv(mode, process.cwd(), '').VITE_API_URL
  const requiresHttps = mode === 'staging' || mode === 'production'

  if (!configuredApiUrl && requiresHttps) {
    throw new Error('VITE_API_URL must be set when building for staging or production')
  }

  if (configuredApiUrl) {
    let apiUrl: URL
    try {
      apiUrl = new URL(configuredApiUrl)
    } catch {
      throw new Error('VITE_API_URL must be a valid absolute URL')
    }

    if (apiUrl.origin !== configuredApiUrl || apiUrl.pathname !== '/') {
      throw new Error('VITE_API_URL must contain only the API origin, without a path')
    }
    if (requiresHttps && apiUrl.protocol !== 'https:') {
      throw new Error('VITE_API_URL must use HTTPS for staging and production builds')
    }
  }

  return {
    plugins: [react(), tailwindcss()],
  }
})
