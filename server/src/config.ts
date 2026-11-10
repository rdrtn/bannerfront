import path from 'node:path';

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  /** Pasta onde ficam fontes, imagens enviadas e arquivos temporários. */
  dataDir: string;
  /** Pasta com o build do front-end (opcional; em desenvolvimento o Vite serve). */
  webDir: string | null;
  /** Marca o cookie de sessão como Secure (use quando houver HTTPS). */
  cookieSecure: boolean;
  sessionTtlHours: number;
  /** Origens extras aceitas em requisições que alteram dados. */
  allowedOrigins: string[];
  trustProxy: boolean;
  maxFontBytes: number;
  /** Tentativas de login por minuto, por IP. */
  loginRateLimit: number;
  bootstrapAdmin: { email: string; password: string; name: string } | null;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'sim'].includes(value.toLowerCase());
}

function int(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} deve ser um inteiro positivo (recebido: ${value})`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL não definida. Veja o arquivo .env.example.');

  const adminEmail = env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = env.ADMIN_PASSWORD;

  return {
    port: int(env.PORT, 3000, 'PORT'),
    host: env.HOST || '0.0.0.0',
    databaseUrl,
    dataDir: path.resolve(env.DATA_DIR || './data'),
    webDir: env.WEB_DIR ? path.resolve(env.WEB_DIR) : null,
    cookieSecure: bool(env.COOKIE_SECURE, false),
    sessionTtlHours: int(env.SESSION_TTL_HOURS, 12, 'SESSION_TTL_HOURS'),
    allowedOrigins: (env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    trustProxy: bool(env.TRUST_PROXY, false),
    maxFontBytes: int(env.MAX_FONT_BYTES, 5_000_000, 'MAX_FONT_BYTES'),
    loginRateLimit: int(env.LOGIN_RATE_LIMIT, 10, 'LOGIN_RATE_LIMIT'),
    bootstrapAdmin:
      adminEmail && adminPassword
        ? { email: adminEmail, password: adminPassword, name: env.ADMIN_NAME?.trim() || 'Administrador' }
        : null,
  };
}
