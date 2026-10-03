import { StudioError } from '../errors.js';

export function createOpenAiImages(
  { apiKey, baseUrl, imageModel, imageQuality, imageSize },
  { fetchImpl = fetch, timeoutMs = 240_000 } = {},
) {
  return {
    name: 'openai',
    model: imageModel,
    // Returns an array of image Buffers (any format; the caller converts to webp).
    async generate({ prompt, n = 1 }) {
      if (!apiKey) throw new StudioError('ai_unavailable', 'OPENAI_API_KEY is not set', { status: 503 });
      const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/images/generations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: imageModel,
          prompt,
          n,
          size: imageSize,
          quality: imageQuality,
          moderation: 'auto',
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      if (!res.ok) {
        throw new StudioError('images_failed', `Image API HTTP ${res.status}: ${text.slice(0, 500)}`, { status: 502 });
      }
      const body = JSON.parse(text);
      const out = [];
      for (const d of body.data ?? []) {
        if (d.b64_json) out.push(Buffer.from(d.b64_json, 'base64'));
        else if (d.url) {
          const img = await fetchImpl(d.url, { signal: AbortSignal.timeout(60_000) });
          if (img.ok) out.push(Buffer.from(await img.arrayBuffer()));
        }
      }
      if (!out.length) throw new StudioError('images_failed', 'Image API returned no images', { status: 502 });
      return out;
    },
  };
}
