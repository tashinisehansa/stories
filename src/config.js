import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load .env from the repo root regardless of cwd (agents may launch us from anywhere).
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // no .env file — fine
}

const env = (name, fallback = '') => {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
};
const flag = (name) => /^(1|true|yes|on)$/i.test(env(name));
const int = (name, fallback) => {
  const n = Number.parseInt(env(name), 10);
  return Number.isFinite(n) ? n : fallback;
};

export function loadConfig(overrides = {}) {
  const siteUrl = env('SITE_URL', 'https://tashinisehansa.github.io/stories/');
  return {
    host: env('HOST', '0.0.0.0'),
    port: int('PORT', 4321),
    dataDir: path.resolve(ROOT, env('DATA_DIR', 'data')),
    siteDir: path.join(ROOT, 'site'),
    authorName: env('AUTHOR_NAME', 'Tashini'),
    siteTitle: env('SITE_TITLE', "Tashini's Story World"),
    siteUrl: siteUrl && !siteUrl.endsWith('/') ? `${siteUrl}/` : siteUrl,

    mockAi: flag('MOCK_AI'),
    mockGithub: flag('MOCK_GITHUB'),

    openrouter: {
      apiKey: env('OPENROUTER_API_KEY'),
      baseUrl: env('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
      model: env('OPENROUTER_MODEL', 'anthropic/claude-sonnet-5.5'),
    },
    openai: {
      apiKey: env('OPENAI_API_KEY'),
      baseUrl: env('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
      imageModel: env('OPENAI_IMAGE_MODEL', 'gpt-image-1'),
      imageQuality: env('OPENAI_IMAGE_QUALITY', 'medium'),
      imageSize: env('OPENAI_IMAGE_SIZE', '1536x1024'),
    },
    images: {
      candidatesPerScene: int('IMAGE_CANDIDATES', 2),
      dailyLimit: int('IMAGE_DAILY_LIMIT', 40),
      maxScenes: 5,
    },
    github: {
      token: env('TASHINI_GITHUB_TOKEN'),
      user: env('GITHUB_USER', 'tashinisehansa'),
      repo: env('GITHUB_REPO', 'tashinisehansa/stories'),
      branch: env('GITHUB_BRANCH', 'main'),
      pagesWorkflow: env('PAGES_WORKFLOW', 'pages.yml'),
    },

    adminPassword: env('ADMIN_PASSWORD'),
    agentToken: env('AGENT_TOKEN'),
    agentCanApprove: flag('AGENT_CAN_APPROVE'),
    sessionSecret: env('SESSION_SECRET'),
    allowedNetworks: env(
      'ALLOWED_NETWORKS',
      '127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,::1/128,fc00::/7,fe80::/10',
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),

    limits: {
      maxStoryChars: 120_000,
      maxWords: 20_000,
      maxTitleChars: 120,
      expensivePerHour: int('EXPENSIVE_REQUESTS_PER_HOUR', 30),
    },
    ...overrides,
  };
}
