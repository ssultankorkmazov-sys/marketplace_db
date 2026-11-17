export interface ServerConfig {
  databaseUrl: string;
  port: number;
  nodeEnv: string;
  jeffreysDetectorEnabled: boolean;
  jeffreysShadowModeEnabled: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL');
  }
  if (parsedUrl.protocol !== 'postgres:' && parsedUrl.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use postgres:// or postgresql://');
  }

  const portValue = env.PORT?.trim();
  const port = portValue ? Number(portValue) : 3001;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const jeffreysValue = env.JEFFREYS_DETECTOR_ENABLED?.trim().toLowerCase();
  if (jeffreysValue && jeffreysValue !== 'true' && jeffreysValue !== 'false') {
    throw new Error('JEFFREYS_DETECTOR_ENABLED must be true or false');
  }
  const jeffreysShadowValue = env.JEFFREYS_SHADOW_MODE_ENABLED?.trim().toLowerCase();
  if (jeffreysShadowValue && jeffreysShadowValue !== 'true' && jeffreysShadowValue !== 'false') {
    throw new Error('JEFFREYS_SHADOW_MODE_ENABLED must be true or false');
  }

  return {
    databaseUrl,
    port,
    nodeEnv: env.NODE_ENV?.trim() || 'development',
    jeffreysDetectorEnabled: jeffreysValue === 'true',
    jeffreysShadowModeEnabled: jeffreysShadowValue === 'true',
  };
}
