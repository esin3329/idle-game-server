/** Map Cloudflare's Hyperdrive binding onto the existing repository configuration. */
export function configureCloudflareEnvironment(env: Env): void {
  process.env.DB_DRIVER = env.DB_DRIVER;
  process.env.DB_HOST = env.HYPERDRIVE.host;
  process.env.DB_PORT = String(env.HYPERDRIVE.port);
  process.env.DB_USER = env.HYPERDRIVE.user;
  process.env.DB_PASSWORD = env.HYPERDRIVE.password;
  process.env.DB_NAME = env.HYPERDRIVE.database;
  process.env.DB_CONNECTION_LIMIT = env.DB_CONNECTION_LIMIT;
  process.env.LOG_LEVEL = env.LOG_LEVEL;
}
