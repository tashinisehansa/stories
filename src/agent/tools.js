import * as z from 'zod';

// One catalogue of agent tools, used by the MCP servers (stdio + HTTP).
// Every tool is a thin call to the Story Studio REST API.

const id = z.string().describe('Story id, e.g. "story-20261003a1b2c3d4" (from list_stories)');
const waitSeconds = z
  .number()
  .int()
  .min(0)
  .max(600)
  .optional()
  .describe('Seconds to wait for the background job before returning (0 = return immediately). Use wait_for_story to keep waiting.');

const enc = encodeURIComponent;

// Trim a story to what an agent needs (image URLs made absolute).
export function agentStory(s, baseUrl) {
  if (!s) return s;
  return {
    id: s.id,
    title: s.title,
    status: s.status,
    statusLabel: s.statusLabel,
    revision: s.revision,
    wordCount: s.wordCount,
    description: s.description,
    content: s.content,
    approved: Boolean(s.approvedAt),
    approvedAt: s.approvedAt,
    review: s.review,
    characters: s.characters,
    scenes: (s.scenes ?? []).map((sc) => ({
      id: sc.id,
      title: sc.title,
      description: sc.description,
      beforeParagraph: sc.beforeParagraph,
      status: sc.status,
      error: sc.error,
      selected: sc.selected,
      candidates: sc.candidates.map((c) => ({ id: c.id, url: `${baseUrl}/api/stories/${s.id}/images/${sc.id}-${c.id}.webp` })),
    })),
    publishedUrl: s.publishedUrl,
    hidden: s.hidden,
    lastError: s.lastError,
    links: {
      editor: `${baseUrl}/editor.html?id=${s.id}`,
      review: `${baseUrl}/review.html?id=${s.id}`,
      pictures: `${baseUrl}/pictures.html?id=${s.id}`,
      preview: `${baseUrl}/preview.html?id=${s.id}`,
    },
  };
}

const busy = (s) =>
  s.review?.status === 'running' || s.status === 'PUBLISHING' || (s.scenes ?? []).some((sc) => ['queued', 'generating'].includes(sc.status));

export function toolDefinitions(client) {
  const story = (s) => agentStory(s, client.linkBase ?? client.baseUrl);
  return [
    {
      name: 'studio_status',
      description: 'Check that Story Studio is running and which AI/publishing services are configured.',
      input: {},
      run: async () => ({ ...(await client.get('/api/health')), ...(await client.get('/api/whoami')) }),
    },
    {
      name: 'list_stories',
      description: "List all of Tashini's stories (drafts, in review, ready, published) with status and word count.",
      input: {},
      run: async () => client.get('/api/stories'),
    },
    {
      name: 'get_story',
      description: 'Get one story: full text, status, review summary, scenes and picture candidates.',
      input: { story_id: id },
      run: async ({ story_id }) => story(await client.get(`/api/stories/${enc(story_id)}`)),
    },
    {
      name: 'create_story',
      description:
        "Create a new draft story. Only use text Tashini wrote or dictated — never invent the story for her; the app exists to help her write, not to write for her.",
      input: { title: z.string().max(120).optional(), content: z.string().optional() },
      run: async ({ title = '', content = '' }) => story(await client.post('/api/stories', { title, content })),
    },
    {
      name: 'update_story',
      description: "Replace a story's title, text and/or short description (as Tashini asked). Creates a new revision; earlier versions stay restorable.",
      input: {
        story_id: id,
        title: z.string().max(120).optional(),
        content: z.string().optional(),
        description: z.string().max(300).optional(),
      },
      run: async ({ story_id, ...patch }) => story(await client.put(`/api/stories/${enc(story_id)}`, patch)),
    },
    {
      name: 'finish_story',
      description:
        "Tashini says she's finished: snapshot the original, run the friendly AI review (grammar suggestions, strengths, ideas, scenes) and then start making pictures. Does NOT publish.",
      input: { story_id: id, make_pictures: z.boolean().optional().describe('Start pictures after the review (default true)'), wait_seconds: waitSeconds },
      run: async ({ story_id, make_pictures = true, wait_seconds = 0 }) => {
        const r = await client.post(`/api/stories/${enc(story_id)}/finish`, { autoImages: make_pictures, wait: wait_seconds });
        return { reviewFinished: r.reviewFinished, story: story(r.story) };
      },
    },
    {
      name: 'get_review',
      description:
        'Get the AI review: grammarSuggestions (each with id, original, suggestion, explanation, status pending/accepted/kept/stale), strengths, improvements, writing tips and optional writing ideas.',
      input: { story_id: id },
      run: async ({ story_id }) => client.get(`/api/stories/${enc(story_id)}/review`),
    },
    {
      name: 'get_feedback_history',
      description:
        "Tashini's saved feedback for a story — every check is kept so she can look back at what to improve. Without check_key: lists the checks. With check_key ('current' or a key from the list): that check's feedback. Chinese feedback includes a `pinyin` map (text → per-character pinyin).",
      input: { story_id: id, check_key: z.string().optional() },
      run: async ({ story_id, check_key }) =>
        check_key
          ? client.get(`/api/stories/${enc(story_id)}/feedback/${enc(check_key)}`)
          : client.get(`/api/stories/${enc(story_id)}/feedback`),
    },
    {
      name: 'decide_suggestion',
      description:
        'Apply Tashini\'s choice for one grammar suggestion: "accept" (Use Suggestion) or "keep" (Keep My Sentence). Ask her first; never accept on her behalf without asking.',
      input: { story_id: id, suggestion_id: z.string(), action: z.enum(['accept', 'keep']) },
      run: async ({ story_id, suggestion_id, action }) => {
        const r = await client.post(`/api/stories/${enc(story_id)}/suggestions/${enc(suggestion_id)}`, { action });
        return { suggestion: r.suggestion, applied: r.applied, revision: r.story.revision };
      },
    },
    {
      name: 'accept_all_suggestions',
      description: 'Use every pending grammar suggestion at once (only when Tashini asks for that).',
      input: { story_id: id },
      run: async ({ story_id }) => {
        const r = await client.post(`/api/stories/${enc(story_id)}/suggestions/accept-all`);
        return { applied: r.results.filter((x) => x.applied).length, story: story(r.story) };
      },
    },
    {
      name: 'generate_pictures',
      description:
        'Make cartoon pictures. With no scene_ids, draws scenes that have no pictures yet (or failed). Pass scene_ids to redraw ("Generate Again") specific scenes.',
      input: { story_id: id, scene_ids: z.array(z.string()).optional(), wait_seconds: waitSeconds },
      run: async ({ story_id, scene_ids, wait_seconds = 0 }) => {
        const r = await client.post(`/api/stories/${enc(story_id)}/images`, { sceneIds: scene_ids, wait: wait_seconds });
        return { imagesFinished: r.imagesFinished, story: story(r.story) };
      },
    },
    {
      name: 'update_scene',
      description:
        'Change one picture scene: choose which candidate picture to use (selected_candidate), what it shows (description — redraw afterwards), or where it appears (before_paragraph, 0-based).',
      input: {
        story_id: id,
        scene_id: z.string().describe('e.g. "scene-01"'),
        selected_candidate: z.string().nullable().optional().describe('Candidate id like "c1a2b3c", or null for no picture'),
        description: z.string().max(500).optional(),
        before_paragraph: z.number().int().min(0).optional(),
      },
      run: async ({ story_id, scene_id, selected_candidate, description, before_paragraph }) =>
        story(
          await client.patch(`/api/stories/${enc(story_id)}/scenes/${enc(scene_id)}`, {
            ...(selected_candidate !== undefined ? { selected: selected_candidate } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(before_paragraph !== undefined ? { beforeParagraph: before_paragraph } : {}),
          }),
        ),
    },
    {
      name: 'add_scene',
      description: 'Add a new picture scene (max 5 per story), then call generate_pictures to draw it.',
      input: { story_id: id, description: z.string().max(500), before_paragraph: z.number().int().min(0).optional() },
      run: async ({ story_id, description, before_paragraph = 0 }) =>
        story(await client.post(`/api/stories/${enc(story_id)}/scenes`, { description, beforeParagraph: before_paragraph })),
    },
    {
      name: 'remove_scene',
      description: 'Remove a picture scene from the story.',
      input: { story_id: id, scene_id: z.string() },
      run: async ({ story_id, scene_id }) => story(await client.del(`/api/stories/${enc(story_id)}/scenes/${enc(scene_id)}`)),
    },
    {
      name: 'wait_for_story',
      description: 'Wait (up to `seconds`) until the review, pictures or publishing for a story are no longer running, then return the story.',
      input: { story_id: id, seconds: z.number().int().min(1).max(600).optional() },
      run: async ({ story_id, seconds = 25 }) => {
        const until = Date.now() + seconds * 1000;
        let s = await client.get(`/api/stories/${enc(story_id)}`);
        while (busy(s) && Date.now() < until) {
          await new Promise((r) => setTimeout(r, 2000));
          s = await client.get(`/api/stories/${enc(story_id)}`);
        }
        return { stillWorking: busy(s), story: story(s) };
      },
    },
    {
      name: 'preview_link',
      description: 'Links Tashini can open on the home network to review, pick pictures, preview and approve the story.',
      input: { story_id: id },
      run: async ({ story_id }) => story(await client.get(`/api/stories/${enc(story_id)}`)).links,
    },
    {
      name: 'approve_story',
      description:
        'Mark the story as approved by Tashini. Usually refused for agents: Tashini approves herself in the Story Studio preview. Only works if the parent enabled AGENT_CAN_APPROVE.',
      input: { story_id: id },
      run: async ({ story_id }) => story(await client.post(`/api/stories/${enc(story_id)}/approve`)),
    },
    {
      name: 'publish_story',
      description:
        "Publish an approved story to Tashini's public story website (GitHub Pages). Fails with not_approved until Tashini has approved it in the Story Studio preview.",
      input: { story_id: id, wait_seconds: waitSeconds },
      run: async ({ story_id, wait_seconds = 120 }) => {
        const r = await client.post(`/api/stories/${enc(story_id)}/publish`, { wait: wait_seconds });
        return { ...r, story: story(r.story) };
      },
    },
    {
      name: 'publish_status',
      description: 'Check whether the published story is live on the website yet (GitHub Pages deploy state).',
      input: { story_id: id },
      run: async ({ story_id }) => client.get(`/api/stories/${enc(story_id)}/publish-status`),
    },
    {
      name: 'list_revisions',
      description: 'List saved versions of a story (original, before checking, published…).',
      input: { story_id: id },
      run: async ({ story_id }) => client.get(`/api/stories/${enc(story_id)}/revisions`),
    },
    {
      name: 'restore_revision',
      description: 'Go back to an earlier saved version of a story (the current text is saved first).',
      input: { story_id: id, revision: z.number().int().min(1) },
      run: async ({ story_id, revision }) => story(await client.post(`/api/stories/${enc(story_id)}/revisions/${revision}/restore`)),
    },
  ];
}
