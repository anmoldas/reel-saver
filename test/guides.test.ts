import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../api/guides.js';
import { addAnswers, formatSections, type IdeaRow } from '../src/guides.js';

describe('formatSections', () => {
  it('writes plain bullets for one section', () => {
    expect(formatSections([{ heading: 'ignored', points: ['Go early', ' ', 'Get a Suica'] }])).toBe('• Go early\n• Get a Suica');
  });

  it('puts a heading above each section when there are several, skipping empty ones', () => {
    const text = formatSections([
      { heading: 'Shopping', points: ['Bring your passport for tax-free'] },
      { heading: 'Empty', points: [] },
      { heading: 'Kyoto', points: ['Visit Fushimi Inari at dawn', 'Book kaiseki ahead'] },
    ]);
    expect(text).toBe('Shopping\n• Bring your passport for tax-free\n\nKyoto\n• Visit Fushimi Inari at dawn\n• Book kaiseki ahead');
  });

  it('copes with junk', () => {
    expect(formatSections(undefined)).toBe('');
    expect(formatSections([{ points: 'x' }, null])).toBe('');
  });
});

describe('addAnswers', () => {
  const idea = (title: string): IdeaRow => ({ title, source_url: `u-${title}`, summary: '', topic: '', guide: '' });
  const batch = [idea('Kyoto tips'), idea('CapCut tutorial'), idea('Lounges')];

  it('maps answers back to ideas, reusing known spellings and remembering new names', () => {
    const known = ['Japan'];
    const out = addAnswers(batch, [
      { id: 0, guide: 'JAPAN' },
      { id: 1, guide: 'Video editing' },
      { id: 0, guide: 'Kyoto' }, // second answer for the same idea
      { id: 7, guide: 'Nope' },
      { id: 2, guide: '' },
    ], known);
    expect(out).toEqual([
      { title: 'Kyoto tips', guide: 'Japan', source_url: 'u-Kyoto tips' },
      { title: 'CapCut tutorial', guide: 'Video editing', source_url: 'u-CapCut tutorial' },
    ]);
    expect(known).toEqual(['Japan', 'Video editing']);
  });
});

const post = (body: unknown) => POST(new Request('https://x/api/guides', { method: 'POST', body: JSON.stringify(body) }));

describe('POST /api/guides', () => {
  afterEach(() => vi.unstubAllGlobals());
  Object.assign(process.env, { SECRET: 'sek', APIFY_TOKEN: 'a', GEMINI_API_KEY: 'g', SHEET_URL: 'https://sheet.test/exec' });

  it('needs the secret', async () => {
    expect((await post({ secret: 'nope', action: 'list' })).status).toBe(401);
  });

  it('lists guides by number of videos', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ ok: true, rows: [{ guide: 'Japan' }, { guide: 'japan ' }, { guide: '' }, { guide: 'Amsterdam' }] })),
    );
    const data = await (await post({ secret: 'sek', action: 'list' })).json();
    expect(data.guides).toEqual([{ guide: 'Japan', videos: 2 }, { guide: 'Amsterdam', videos: 1 }]);
  });

  it('refuses assignments that are not { source_url, guide }', async () => {
    const res = await post({ secret: 'sek', action: 'assign', assignments: [{ source_url: 'u' }] });
    expect(res.status).toBe(400);
  });
});
