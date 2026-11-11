export type Config = { port: number; debug: boolean };

export function loadConfig(env: Record<string, string | undefined>): Config {
  return {
    port: Number(env.PORT) || 3000,
    debug: env.DEBUG === 'true',
  };
}
