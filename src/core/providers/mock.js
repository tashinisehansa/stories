import crypto from 'node:crypto';
import sharp from 'sharp';

// Offline stand-ins used by tests and by MOCK_AI=1 so the whole flow can be
// exercised without API keys. They are deterministic for a given input.

const FIXES = [
  [/\bi\b(?!')/g, 'I', 'spelling', 'We always write "I" with a capital letter.'],
  [/\balot\b/gi, 'a lot', 'spelling', '"A lot" is two words.'],
  [/\bdont\b/gi, "don't", 'punctuation', "\"Don't\" needs an apostrophe because it is short for \"do not\"."],
  [/\bbecuase\b/gi, 'because', 'spelling', '"Because" is spelled b-e-c-a-u-s-e.'],
  [/\b(he|she|it|the \w+) run\b/gi, (m) => m.replace(/run$/, 'ran'), 'grammar', '"Ran" is the past tense of "run", and your story happens in the past.'],
  [/\b(he|she|it|the \w+) go\b/gi, (m) => m.replace(/go$/, 'went'), 'grammar', '"Went" is the past tense of "go".'],
];

function sentencesOf(text) {
  return text.match(/[^.!?\n]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
}

export function mockReviewFor({ title, paragraphs, author = 'Tashini' }) {
  const text = paragraphs.join('\n');
  const grammarSuggestions = [];
  for (const sentence of sentencesOf(text)) {
    let fixed = sentence;
    const reasons = [];
    let type = 'grammar';
    for (const [re, rep, t, why] of FIXES) {
      const next = fixed.replace(re, rep);
      if (next !== fixed) {
        fixed = next;
        reasons.push(why);
        type = t;
      }
    }
    if (fixed !== sentence) grammarSuggestions.push({ original: sentence, suggestion: fixed, explanation: reasons.join(' '), type });
  }

  const counts = new Map();
  for (const m of text.matchAll(/(?<![.!?]\s|^)\b([A-Z][a-z]{2,})\b/gm)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  const names = [...counts.entries()].filter(([, c]) => c >= 1).map(([n]) => n).slice(0, 3);
  const characters = (names.length ? names : ['The hero']).map((name, i) => ({
    name,
    description: ['a cheerful 9-year-old girl with black hair in two braids, a blue dress and a yellow backpack',
      'a small friendly green dragon with round eyes and tiny wings',
      'a fluffy brown puppy with a red collar'][i % 3],
  }));

  const n = paragraphs.length;
  const picks = [...new Set([0, Math.floor(n / 2), n - 1])].filter((i) => i >= 0 && i < n).slice(0, n > 6 ? 3 : 2);
  const scenes = (picks.length ? picks : [0]).map((p, i) => ({
    sceneNumber: i + 1,
    title: `Scene ${i + 1}`,
    description: (paragraphs[p] ?? title).slice(0, 160),
    imagePrompt: `${paragraphs[p] ?? title}`.slice(0, 600),
    beforeParagraph: p,
    characters: characters.map((c) => c.name),
  }));

  let corrected = text;
  for (const g of grammarSuggestions) corrected = corrected.replace(g.original, g.suggestion);

  return {
    summary: `What a lovely story, ${author}! It has a clear idea and fun moments.`,
    suggestedTitle: title ? null : 'My Wonderful Story',
    suggestedDescription: `A story by ${author} about ${characters[0].name}.`,
    correctedStory: corrected.split('\n').join('\n\n'),
    strengths: ['Your story has a clear beginning, middle and ending.', 'You chose fun and interesting characters.'],
    improvements: ['Add more details about how the characters felt.', 'Try using some dialogue in one scene.'],
    writingTips: ['Use your five senses: what could your character see, hear and smell?'],
    structureFeedback: 'Your beginning sets up the adventure nicely. The ending could tell us how the character feels.',
    grammarSuggestions,
    writingIdeas: [{ idea: 'Describe the setting before the action begins.', original: null, example: 'The forest was quiet and full of tall, whispering trees.' }],
    vocabularySuggestions: [{ word: 'big', alternatives: ['huge', 'giant', 'enormous'], explanation: 'Different words can make your writing more exciting.' }],
    characters,
    scenes,
    safetyConcerns: [],
  };
}

export function createMockLlm({ fail = false, invalid = false } = {}) {
  return {
    name: 'mock',
    model: 'mock-reviewer',
    calls: 0,
    async complete({ context }) {
      this.calls += 1;
      if (fail) throw new Error('mock LLM failure');
      if (invalid) return { text: '{"summary": "oops"', model: 'mock-reviewer' };
      return { text: JSON.stringify(mockReviewFor(context)), model: 'mock-reviewer' };
    },
  };
}

export function createMockImages({ fail = false } = {}) {
  return {
    name: 'mock',
    model: 'mock-painter',
    calls: 0,
    async generate({ prompt, n = 1 }) {
      this.calls += 1;
      if (typeof fail === 'function' ? fail(this.calls) : fail) throw new Error('mock image failure');
      const out = [];
      for (let i = 0; i < n; i++) {
        const h = crypto.createHash('sha1').update(`${prompt}#${i}#${this.calls}`).digest();
        const hue = h[0] * 1.4;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="512">
          <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="hsl(${hue},80%,82%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},70%,70%)"/>
          </linearGradient></defs>
          <rect width="768" height="512" fill="url(#g)"/>
          <circle cx="${200 + h[1]}" cy="${150 + (h[2] % 80)}" r="70" fill="hsl(${(hue + 180) % 360},90%,75%)"/>
          <ellipse cx="384" cy="470" rx="420" ry="90" fill="hsl(${(hue + 100) % 360},50%,55%)"/>
          <circle cx="${420 + (h[3] % 120)}" cy="330" r="46" fill="#fff8e7" stroke="#5a4636" stroke-width="6"/>
          <circle cx="${405 + (h[3] % 120)}" cy="322" r="6" fill="#5a4636"/><circle cx="${435 + (h[3] % 120)}" cy="322" r="6" fill="#5a4636"/>
        </svg>`;
        out.push(await sharp(Buffer.from(svg)).png().toBuffer());
      }
      return out;
    },
  };
}
