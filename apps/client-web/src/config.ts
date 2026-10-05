const configuredApiUrl = import.meta.env.VITE_API_URL
const requiresHttps = import.meta.env.PROD || import.meta.env.MODE === 'staging'

if (!configuredApiUrl && requiresHttps) {
  throw new Error('VITE_API_URL must be configured for staging and production builds')
}

const apiUrl = configuredApiUrl ?? 'http://localhost:3000'
let parsedApiUrl: URL

try {
  parsedApiUrl = new URL(apiUrl)
} catch {
  throw new Error('VITE_API_URL must be a valid absolute URL')
}

if (parsedApiUrl.origin !== apiUrl || parsedApiUrl.pathname !== '/') {
  throw new Error('VITE_API_URL must contain only the API origin, without a path')
}

if (requiresHttps && parsedApiUrl.protocol !== 'https:') {
  throw new Error('VITE_API_URL must use HTTPS for staging and production builds')
}

export const API_URL = apiUrl
