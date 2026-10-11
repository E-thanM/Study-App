import Anthropic from '@anthropic-ai/sdk';
import { stripHtml } from './util';

/*
 * Turning short-term terms (or raw notes) into long-term flashcards.
 *
 * Three routes, all producing the same JSON shape:
 *  1. Claude.ai (free with a Pro plan): copy the generated prompt, paste into claude.ai,
 *     paste the reply back.
 *  2. Claude API with your own key (pay-as-you-go, stored only on this device).
 *  3. Offline rules (no AI): sensible defaults for card types.
 */

export interface AiCard {
  type: 'basic' | 'reversed' | 'cloze';
  front: string;
  back: string;
  /** cloze text with {{c1::…}} deletions when type = cloze */
  text?: string;
  extra?: string;
  tags?: string[];
}

export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best quality)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (balanced)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (cheapest, fast)' },
];

const AI_KEY = 'study.ai';
export interface AiSettings {
  apiKey: string;
  model: string;
}
export function getAiSettings(): AiSettings {
  try {
    return { apiKey: '', model: AI_MODELS[0].id, ...JSON.parse(localStorage.getItem(AI_KEY) || '{}') };
  } catch {
    return { apiKey: '', model: AI_MODELS[0].id };
  }
}
export function saveAiSettings(s: AiSettings) {
  localStorage.setItem(AI_KEY, JSON.stringify(s));
}

const GUIDE = `You are an expert at writing spaced-repetition flashcards for UK GCSE students, following the "20 rules of formulating knowledge" (minimum information principle, atomic facts, no sets/enumerations on one card, use cloze deletions for definitions and processes, avoid ambiguity, add context cues, keep wording short).

Rewrite the material below into long-term memory flashcards:
- Split any card that tests more than one fact into several atomic cards.
- Use "cloze" for definitions, processes, equations and lists (one deletion per key idea: {{c1::…}}, {{c2::…}}; each number becomes its own card). Keep the surrounding sentence as context.
- Use "reversed" only when recalling in both directions is genuinely useful (e.g. vocabulary, key term ↔ definition).
- Otherwise use "basic" with a precise question on the front.
- Keep exam-relevant wording (mark-scheme keywords). Fix factual errors if any, but do not invent new content beyond what is needed to make cards answerable.
- Add 1–3 short lowercase tags (topic names, no spaces – use_underscores).
- Equations may use LaTeX inside \\( … \\).`;

const FORMAT = `Reply with ONLY a JSON array (no commentary, no code fences), each item:
{"type":"basic"|"reversed"|"cloze","front":"question (empty for cloze)","back":"answer (empty for cloze)","text":"cloze sentence with {{c1::…}} (only for cloze)","extra":"optional extra info","tags":["topic"]}`;

export function buildPrompt(input: { subject?: string; terms?: { term: string; definition: string }[]; notes?: string }): string {
  const parts = [GUIDE];
  if (input.subject) parts.push(`Subject / topic: ${input.subject}`);
  if (input.terms?.length)
    parts.push('Material (term ⇥ definition):\n' + input.terms.map((t) => `${stripHtml(t.term)}\t${stripHtml(t.definition)}`).join('\n'));
  if (input.notes?.trim()) parts.push('Material (notes):\n' + input.notes.trim());
  parts.push(FORMAT);
  return parts.join('\n\n');
}

/** Tolerant parser for the model's reply (JSON array, fenced JSON, or TSV fallback). */
export function parseAiReply(reply: string): AiCard[] {
  let txt = reply.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(txt);
  if (fence) txt = fence[1].trim();
  const start = txt.indexOf('[');
  const end = txt.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try {
      const arr = JSON.parse(txt.slice(start, end + 1)) as Partial<AiCard>[];
      return arr
        .map((c) => ({
          type: (c.type === 'cloze' || c.type === 'reversed' ? c.type : 'basic') as AiCard['type'],
          front: String(c.front || ''),
          back: String(c.back || ''),
          text: c.text ? String(c.text) : undefined,
          extra: c.extra ? String(c.extra) : undefined,
          tags: Array.isArray(c.tags) ? c.tags.map(String) : [],
        }))
        .filter((c) => (c.type === 'cloze' ? /\{\{c\d+::/.test(c.text || '') : c.front.trim()));
    } catch {
      /* fall through */
    }
  }
  // TSV fallback: front<TAB>back per line
  return txt
    .split(/\r?\n/)
    .map((l) => l.split('\t'))
    .filter((p) => p.length >= 2 && p[0].trim())
    .map(([front, back]) => ({ type: 'basic' as const, front: front.trim(), back: back.trim(), tags: [] }));
}

const CARD_SCHEMA = {
  type: 'object',
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['basic', 'reversed', 'cloze'] },
          front: { type: 'string' },
          back: { type: 'string' },
          text: { type: 'string' },
          extra: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['type', 'front', 'back', 'text', 'extra', 'tags'],
        additionalProperties: false,
      },
    },
  },
  required: ['cards'],
  additionalProperties: false,
};

/** Call the Claude API directly from the browser with the user's own key. */
export async function generateWithClaude(prompt: string, settings: AiSettings): Promise<AiCard[]> {
  if (!settings.apiKey) throw new Error('Add your Claude API key in Settings first.');
  const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true });
  // Opus/Sonnet: retry on a different model automatically if a safety classifier declines.
  const withFallback = settings.model !== 'claude-haiku-5-5';
  const stream = client.beta.messages.stream({
    model: settings.model,
    max_tokens: 32000,
    ...(withFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: CARD_SCHEMA } },
    messages: [{ role: 'user', content: prompt.replace(FORMAT, 'Return the cards in the "cards" array.') }],
  });
  let msg;
  try {
    msg = await stream.finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Your Claude API key was rejected – check it in Settings.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Rate limited by the Claude API – wait a minute and try again.');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('Could not reach the Claude API – check your connection.');
    if (e instanceof Anthropic.APIError) throw new Error(`Claude API error: ${e.message}`);
    throw e;
  }
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined to process this content.');
  const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  try {
    const parsed = JSON.parse(text) as { cards: AiCard[] };
    return parseAiReply(JSON.stringify(parsed.cards));
  } catch {
    return parseAiReply(text);
  }
}

/** Offline conversion without AI. */
export function convertOffline(terms: { term: string; definition: string }[], mode: 'auto' | 'basic' | 'reversed' | 'cloze'): AiCard[] {
  return terms
    .filter((t) => t.term.trim())
    .map((t) => {
      const words = (s: string) => stripHtml(s).split(/\s+/).filter(Boolean).length;
      let type: AiCard['type'] = mode === 'auto' ? 'basic' : mode;
      if (mode === 'auto') type = words(t.term) <= 4 && words(t.definition) <= 6 ? 'reversed' : 'basic';
      if (type === 'cloze') {
        return { type, front: '', back: '', text: `{{c1::${t.term}}} – ${t.definition}`, tags: [] };
      }
      return { type, front: t.term, back: t.definition, tags: [] };
    });
}
