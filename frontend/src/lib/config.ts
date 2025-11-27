// Runtime configuration - loaded at app startup
// This allows changing API URL without rebuilding the image

interface RuntimeConfig {
  apiUrl: string;
}

let config: RuntimeConfig | null = null;

export async function loadConfig(): Promise<RuntimeConfig> {
  if (config) return config;

  try {
    const response = await fetch('/config.json');
    if (response.ok) {
      const data = await response.json();
      // Only use runtime config if it's not the placeholder
      if (data.apiUrl && data.apiUrl !== '__API_URL__') {
        config = data;
        return config;
      }
    }
  } catch {
    // Fall through to build-time config
  }

  // Fallback to build-time VITE_API_URL or default
  config = {
    apiUrl: import.meta.env.VITE_API_URL || 'http://localhost:3000/trpc',
  };
  return config;
}

export function getConfig(): RuntimeConfig {
  if (!config) {
    throw new Error('Config not loaded. Call loadConfig() first.');
  }
  return config;
}

// For synchronous access after config is loaded
export function getApiUrl(): string {
  return config?.apiUrl || import.meta.env.VITE_API_URL || 'http://localhost:3000/trpc';
}
