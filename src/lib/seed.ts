import { all, get, put } from './store';
import type { NoteType, Preset, Settings } from './types';
import { setDayStartHour } from './util';

/** A daily limit this high means every new card is available straight away. */
export const NO_LIMIT = 9999;

const DEFAULT_CSS = `.card { font-size: 22px; text-align: center; line-height: 1.5; }`;

// Seed records use updatedAt = 1 so that any real edit on any device wins the merge.
export const BUILTIN_NOTETYPES: NoteType[] = [
  {
    id: 'nt-basic',
    kind: 'notetype',
    updatedAt: 1,
    builtin: true,
    name: 'Basic',
    type: 'standard',
    fields: ['Front', 'Back'],
    templates: [{ name: 'Card 1', front: '{{Front}}', back: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}' }],
    css: DEFAULT_CSS,
  },
  {
    id: 'nt-basic-reversed',
    kind: 'notetype',
    updatedAt: 1,
    builtin: true,
    name: 'Basic (and reversed card)',
    type: 'standard',
    fields: ['Front', 'Back'],
    templates: [
      { name: 'Card 1', front: '{{Front}}', back: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}' },
      { name: 'Card 2', front: '{{Back}}', back: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}' },
    ],
    css: DEFAULT_CSS,
  },
  {
    id: 'nt-basic-optional-reversed',
    kind: 'notetype',
    updatedAt: 1,
    builtin: true,
    name: 'Basic (optional reversed card)',
    type: 'standard',
    fields: ['Front', 'Back', 'Add Reverse'],
    templates: [
      { name: 'Card 1', front: '{{Front}}', back: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}' },
      { name: 'Card 2', front: '{{#Add Reverse}}{{Back}}{{/Add Reverse}}', back: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}' },
    ],
    css: DEFAULT_CSS,
  },
  {
    id: 'nt-basic-type',
    kind: 'notetype',
    updatedAt: 1,
    builtin: true,
    name: 'Basic (type in the answer)',
    type: 'standard',
    fields: ['Front', 'Back'],
    templates: [{ name: 'Card 1', front: '{{Front}}\n\n{{type:Back}}', back: '{{Front}}\n\n<hr id=answer>\n\n{{type:Back}}' }],
    css: DEFAULT_CSS,
  },
  {
    id: 'nt-cloze',
    kind: 'notetype',
    updatedAt: 1,
    builtin: true,
    name: 'Cloze',
    type: 'cloze',
    fields: ['Text', 'Back Extra'],
    templates: [{ name: 'Cloze', front: '{{cloze:Text}}', back: '{{cloze:Text}}<br>\n{{Back Extra}}' }],
    css: DEFAULT_CSS + `\n.cloze { font-weight: 700; color: var(--accent); }`,
  },
];

export const OCCLUSION_NOTETYPE: NoteType = {
  id: 'nt-image-occlusion',
  kind: 'notetype',
  updatedAt: 1,
  builtin: true,
  name: 'Image occlusion (cover-up diagram)',
  type: 'occlusion',
  fields: ['Image', 'Header', 'Back Extra', 'Masks'],
  // cards are drawn by lib/occlusion.ts; templates are only shown for reference
  templates: [{ name: 'Box', front: '{{Image}}', back: '{{Image}}' }],
  css: DEFAULT_CSS,
};
BUILTIN_NOTETYPES.push(OCCLUSION_NOTETYPE);

export const DEFAULT_PRESET: Preset = {
  id: 'preset-default',
  kind: 'preset',
  updatedAt: 1,
  name: 'Default',
  newPerDay: NO_LIMIT,
  reviewsPerDay: 200,
  learningSteps: ['1m', '10m'],
  relearningSteps: ['10m'],
  algorithm: 'fsrs',
  desiredRetention: 0.9,
  maxInterval: 36500,
  graduatingInterval: 1,
  easyInterval: 4,
  startingEase: 2.5,
  easyBonus: 1.3,
  intervalModifier: 1,
  hardInterval: 1.2,
  newInterval: 0,
  minInterval: 1,
  leechThreshold: 8,
  leechAction: 'tag',
  newCardOrder: 'added',
  newReviewMix: 'mix',
  buryNewSiblings: true,
  buryReviewSiblings: true,
  showTimer: false,
  maxAnswerSeconds: 60,
  autoplayAudio: true,
};

/** A preset tuned for an exam on a fixed date: more new cards, slightly higher retention. */
export const EXAM_PRESET: Preset = {
  ...DEFAULT_PRESET,
  id: 'preset-exam',
  name: 'GCSE cram (higher retention)',
  newPerDay: NO_LIMIT,
  reviewsPerDay: 9999,
  desiredRetention: 0.92,
  maxInterval: 180,
};

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  kind: 'settings',
  updatedAt: 1,
  dayStartHour: 4,
  weekStartsMonday: true,
  countTimetableHours: true,
  weeklyGoalHours: 15,
};

export function ensureSeed() {
  const missing = [
    ...BUILTIN_NOTETYPES.filter((n) => !get('notetype', n.id)),
    ...[DEFAULT_PRESET, EXAM_PRESET].filter((p) => !get('preset', p.id)),
    ...(get('settings', 'settings') ? [] : [DEFAULT_SETTINGS]),
  ];
  if (missing.length) put(missing, { keepUpdatedAt: true });
  setDayStartHour(getSettings().dayStartHour);
}

export function getSettings(): Settings {
  return get('settings', 'settings') || DEFAULT_SETTINGS;
}

export function getPreset(id: string | undefined): Preset {
  return { ...DEFAULT_PRESET, ...(get('preset', id) || get('preset', DEFAULT_PRESET.id) || {}) };
}

export const allPresets = () => all('preset');

/**
 * One-off change: new cards are no longer trickled in (e.g. 6 a day) – every preset shows them all.
 * Runs once per account (flag stored in synced settings), after its data has been pulled.
 */
export function migrateUnlimitedNew() {
  const s = getSettings();
  if (s.allNewCards) return;
  const capped = all('preset').filter((p) => !p.deleted && p.newPerDay < NO_LIMIT);
  if (capped.length) put(capped.map((p) => ({ ...p, newPerDay: NO_LIMIT })));
  put({ ...s, allNewCards: true });
}
