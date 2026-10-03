import { StudioError } from '../errors.js';

// OpenAI-compatible chat client. Defaults to OpenRouter, but any compatible
// endpoint works by changing OPENROUTER_BASE_URL / OPENROUTER_MODEL.
export function createOpenRouterLlm({ apiKey, baseUrl, model }, { fetchImpl = fetch, timeoutMs = 180_000 } = {}) {
  return {
    name: 'openrouter',
    model,
    async complete({ system, user, maxTokens = 8000, temperature = 0.3 }) {
      if (!apiKey) throw new StudioError('ai_unavailable', 'OPENROUTER_API_KEY is not set', { status: 503 });
      const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/tashinisehansa/stories',
          'X-Title': 'Story Studio',
        },
        body: JSON.stringify({
          model,
          temperature,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      if (!res.ok) {
        throw new StudioError('ai_unavailable', `LLM HTTP ${res.status}: ${text.slice(0, 500)}`, { status: 502 });
      }
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new StudioError('ai_unavailable', `LLM returned non-JSON envelope: ${text.slice(0, 200)}`, { status: 502 });
      }
      if (body.error) {
        throw new StudioError('ai_unavailable', `LLM error: ${JSON.stringify(body.error).slice(0, 500)}`, { status: 502 });
      }
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new StudioError('ai_unavailable', 'LLM returned an empty message', { status: 502 });
      }
      return { text: content, model: body.model ?? model };
    },
  };
}
