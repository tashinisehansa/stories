import { StudioError } from '../errors.js';

// OpenAI-compatible chat client used for the story review (OpenRouter, DeepSeek, …).
// `jsonMode` asks the provider for a JSON object; the reply is still schema-validated.
export function createChatLlm(
  { name, apiKey, baseUrl, model, keyName, headers = {}, jsonMode = false, reasoningTokens = 0 },
  { fetchImpl = fetch, timeoutMs = 180_000 } = {},
) {
  return {
    name,
    model,
    async complete({ system, user, maxTokens = 8000, temperature = 0.3 }) {
      if (!apiKey) throw new StudioError('ai_unavailable', `${keyName} is not set`, { status: 503 });
      const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({
          model,
          temperature,
          // Reasoning models spend hidden "thinking" tokens from the same budget.
          max_tokens: maxTokens + reasoningTokens,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
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
      const choice = body.choices?.[0];
      const content = choice?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        const why = choice?.finish_reason === 'length' ? ' (ran out of tokens before answering)' : '';
        throw new StudioError('ai_unavailable', `LLM returned an empty message${why}`, { status: 502 });
      }
      return { text: content, model: body.model ?? model };
    },
  };
}
