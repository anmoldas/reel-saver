import { askJson } from './gemini.js';
import type { Env } from './types.js';

/** A Places row's notes, as the Sheet sends it: found again by its first link and title. */
export interface PlaceNote {
  source_url: string;
  title: string;
  what_to_order: string;
}

export const NOTES_RULES = `Each place below was recommended by several saved social media posts, and "notes" joins what each post said to order, buy or do there, separated by ";".

For each place, rewrite its notes as one short line:
- Say each thing once. When notes say the same thing in different words ("book 6 weeks ahead", "book tickets weeks in advance"), keep the most specific version (numbers, names, dishes).
- Keep every different thing, separated by "; ". Leave out filler like "visit the museum" when the place is a museum.
- Never add anything the notes don't say. Write in English.
Return every place with its "id" unchanged.`;

const BATCH = 40;

function schema() {
  return {
    type: 'OBJECT',
    properties: {
      places: {
        type: 'ARRAY',
        items: { type: 'OBJECT', properties: { id: { type: 'INTEGER' }, notes: { type: 'STRING' } }, required: ['id', 'notes'] },
      },
    },
    required: ['places'],
  };
}

/**
 * Rewrites each place's joined notes into one line without repeats. Places Gemini leaves out, or
 * answers with nothing, are not returned, so their notes stay as they are.
 */
export async function combinePlaceNotes(env: Env, places: PlaceNote[]): Promise<PlaceNote[]> {
  const out: PlaceNote[] = [];
  for (let start = 0; start < places.length; start += BATCH) {
    const batch = places.slice(start, start + BATCH);
    const input = batch.map((p, id) => ({ id, place: p.title, notes: p.what_to_order }));
    const answer = await askJson(env, NOTES_RULES, [{ text: JSON.stringify(input) }], schema());
    for (const a of Array.isArray(answer?.places) ? answer.places : []) {
      const place = batch[Number(a?.id)];
      const notes = typeof a?.notes === 'string' ? a.notes.replace(/\s+/g, ' ').trim() : '';
      if (place && notes && notes !== place.what_to_order) out.push({ ...place, what_to_order: notes });
    }
  }
  return out;
}
