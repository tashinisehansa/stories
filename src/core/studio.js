import crypto from 'node:crypto';
import path from 'node:path';
import { JsonStore } from './store.js';
import { createLogger } from './log.js';
import { JobRunner } from './jobs.js';
import { StoryService } from './stories.js';
import { ReviewService } from './review.js';
import { ImageService } from './images.js';
import { PublishService } from './publish.js';
import { S } from './states.js';
import { GitHubRepo, LocalRepo, resolveGithubToken } from './github.js';
import { createChatLlm } from './providers/llm-chat.js';
import { createOpenAiImages } from './providers/image-openai.js';
import { createMockLlm, createMockImages } from './providers/mock.js';

// Wires every service together. Tests inject `llm`, `imageGen` and `repo`.
export async function createStudio(config, { llm, imageGen, repo, log } = {}) {
  const store = new JsonStore(config.dataDir);
  log ??= createLogger(path.join(config.dataDir, 'logs'), { quiet: config.quietLogs });
  const jobs = new JobRunner(log);

  llm ??= config.mockAi ? createMockLlm() : createReviewLlm(config);
  imageGen ??= config.mockAi ? createMockImages() : createOpenAiImages(config.openai);
  if (!repo) {
    if (config.mockGithub) {
      repo = new LocalRepo(path.join(config.dataDir, 'mock-repo'));
    } else {
      let cached;
      repo = new GitHubRepo({
        repo: config.github.repo,
        branch: config.github.branch,
        getToken: async () => (cached ??= await resolveGithubToken(config.github)),
      });
    }
  }

  const stories = new StoryService({ store, config, log });
  const images = new ImageService({ stories, store, imageGen, jobs, log, config });
  const review = new ReviewService({
    stories,
    store,
    llm,
    jobs,
    log,
    config,
    // Pictures are prepared straight after the check ("We'll check your writing and prepare some pictures").
    onReviewed: async (story) => {
      if (story.scenes.some((sc) => !sc.candidates.length)) {
        const { job } = await images.start(story.id);
        job.catch(() => {});
      }
    },
  });
  const publisher = new PublishService({ stories, store, repo, jobs, log, config });
  const secrets = await loadSecrets(store, config);

  const studio = { config, store, log, jobs, stories, review, images, publisher, repo, llm, imageGen, secrets };
  await recover(studio);
  return studio;
}

export function reviewProviderName(config) {
  const p = config.reviewProvider;
  if (p === 'openrouter' || p === 'deepseek') return p;
  if (config.openrouter.apiKey) return 'openrouter';
  if (config.deepseek.apiKey) return 'deepseek';
  return 'openrouter';
}

function createReviewLlm(config) {
  if (reviewProviderName(config) === 'deepseek') {
    return createChatLlm({ name: 'deepseek', keyName: 'DEEPSEEK_API_KEY', jsonMode: true, ...config.deepseek });
  }
  return createChatLlm({
    name: 'openrouter',
    keyName: 'OPENROUTER_API_KEY',
    headers: { 'HTTP-Referer': 'https://github.com/tashinisehansa/stories', 'X-Title': 'Story Studio' },
    ...config.openrouter,
  });
}

// Generated on first start and kept in data/secrets.json (gitignored).
// Environment variables always win.
async function loadSecrets(store, config) {
  const saved = (await store.read('secrets.json')) ?? {};
  let changed = false;
  const gen = (bytes) => crypto.randomBytes(bytes).toString('base64url');
  if (!saved.sessionSecret) {
    saved.sessionSecret = gen(32);
    changed = true;
  }
  if (!saved.agentToken) {
    saved.agentToken = `ss_${gen(24)}`;
    changed = true;
  }
  if (!saved.adminPassword) {
    saved.adminPassword = gen(9);
    saved.adminPasswordGenerated = true;
    changed = true;
  }
  if (changed) await store.write('secrets.json', saved);
  return {
    get sessionSecret() {
      return config.sessionSecret || saved.sessionSecret;
    },
    get agentToken() {
      return config.agentToken || saved.agentToken;
    },
    get adminPassword() {
      return config.adminPassword || saved.adminPassword;
    },
    adminPasswordFromEnv: Boolean(config.adminPassword),
    agentTokenFromEnv: Boolean(config.agentToken),
    async rotateAgentToken() {
      saved.agentToken = `ss_${gen(24)}`;
      await store.write('secrets.json', saved);
      return saved.agentToken;
    },
  };
}

// After a restart nothing is running any more; turn in-flight work into retryable failures.
async function recover({ stories, log }) {
  for (const summary of await stories.list()) {
    const s = await stories.get(summary.id);
    const stuckReview = s.review?.status === 'running';
    const stuckScenes = s.scenes.some((sc) => ['queued', 'generating'].includes(sc.status));
    const stuckPublish = s.status === S.PUBLISHING;
    if (!stuckReview && !stuckScenes && !stuckPublish) continue;
    await stories.mutate(s.id, (x) => {
      if (stuckReview) {
        x.review.status = 'failed';
        if (x.status === S.REVIEWING) x.status = S.REVIEW_FAILED;
      }
      for (const sc of x.scenes) {
        if (['queued', 'generating'].includes(sc.status)) Object.assign(sc, { status: 'failed', error: 'Interrupted. Please try again.' });
      }
      if (stuckScenes && x.status === S.REVIEWING) x.status = S.IMAGE_GENERATION_FAILED;
      if (stuckPublish) x.status = S.PUBLISH_FAILED;
    });
    log.warn('recover.interrupted', { id: s.id, stuckReview, stuckScenes, stuckPublish });
  }
}
