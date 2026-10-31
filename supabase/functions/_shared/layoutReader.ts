// Shared by read-layout: asks Claude for every plot on a layout drawing.
import Anthropic from 'npm:@anthropic-ai/sdk';

const DIRS = ['N', 'E', 'S', 'W'];
const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ anyOf: [{ type, ...extra }, { type: 'null' }] });

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['project_name', 'location', 'north', 'plots', 'warnings'],
  properties: {
    project_name: nullable('string'),
    location: nullable('string'),
    north: { type: 'string', enum: ['up', 'down', 'left', 'right', 'unknown'] },
    warnings: { type: 'array', items: { type: 'string' } },
    plots: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'x', 'y', 'w', 'h', 'front_ft', 'depth_ft', 'area_sqft', 'facing', 'corner_facing'],
        properties: {
          label: { type: 'string' },
          x: { type: 'number' },
          y: { type: 'number' },
          w: { type: 'number' },
          h: { type: 'number' },
          front_ft: nullable('number'),
          depth_ft: nullable('number'),
          area_sqft: nullable('number'),
          facing: nullable('string', { enum: DIRS }),
          corner_facing: nullable('string', { enum: DIRS }),
        },
      },
    },
  },
};

const SYSTEM = `You read real-estate plot layout drawings (Indian residential plotted layouts, DTCP / NA layouts) from photos, scans and PDF pages, and turn them into structured plot data for a sales app.

Return every saleable plot that has a visible plot number. Leave out roads, open spaces, parks, amenity areas, electric DP / transformer areas and anything without a plot number.

For each plot:
- label: the plot number exactly as written (for example "A12", "17", "B-4").
- x, y, w, h: the plot's bounding box on the image, in units of 0 to 1000 across the image width (x, w) and down the image height (y, h), measured from the top-left corner. Fit the box tightly to the plot's boundary lines, not to the text.
- front_ft, depth_ft: the plot dimensions in feet when they are written on the drawing. front_ft is the side facing the road. Convert metres to feet (1 m = 3.281 ft). Use null when the drawing does not show them; do not estimate.
- area_sqft: the area when it is written on the drawing, converted to square feet (1 sq m = 10.764 sq ft, 1 cent = 435.6 sq ft, 1 gunta = 1089 sq ft). Otherwise null.
- facing: the compass direction of the road the plot's frontage touches. Use the north arrow; if there is none, treat the top of the image as north and add a warning.
- corner_facing: for corner plots, the direction of the second road. Otherwise null.

north says where the drawing's north arrow points on the image.
project_name and location: only if printed on the drawing (title block, village/survey number line), else null.
warnings: short, plain notes for the owner about anything uncertain: unreadable numbers, plots you may have missed, a photo taken at an angle, dimensions you could not read.`;

export type ReadResult = { status: number; body: Record<string, unknown>; usage?: unknown };

export async function readLayoutImage(apiKey: string, data: string, mediaType: 'image/jpeg' | 'image/png' | 'image/webp'): Promise<ReadResult> {
  const client = new Anthropic({ apiKey });
  try {
    const stream = client.beta.messages.stream({
      model: 'claude-opus-5-5',
      max_tokens: 64000,
      // on a policy decline, the API retries on a fallback model inside the same call
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          { type: 'text', text: 'Read this layout drawing and list every plot.' },
        ],
      }],
    });
    const msg = await stream.finalMessage();

    if (msg.stop_reason === 'refusal') return { status: 422, body: { error: 'This picture could not be read. Try a clearer photo of the layout.' } };
    if (msg.stop_reason === 'max_tokens') return { status: 422, body: { error: 'This layout has too many plots to read at once. Try a photo of one part at a time.' } };

    const text = msg.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return { status: 422, body: { error: 'No plots were found in this picture.' } };
    const draft = JSON.parse(text.text);

    // keep only well-formed boxes inside the image
    const clamp = (v: number) => Math.max(0, Math.min(1000, Number(v) || 0));
    draft.plots = (Array.isArray(draft.plots) ? draft.plots : [])
      .map((p: Record<string, unknown>) => ({ ...p, label: String(p.label ?? '').trim(), x: clamp(p.x as number), y: clamp(p.y as number), w: clamp(p.w as number), h: clamp(p.h as number) }))
      .filter((p: { label: string; w: number; h: number }) => p.label && p.w > 0.5 && p.h > 0.5);
    return { status: 200, body: { draft }, usage: { ...msg.usage, model: msg.model } };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return { status: 429, body: { error: 'The layout reader is busy. Please try again in a minute.' } };
    if (e instanceof Anthropic.AuthenticationError) return { status: 503, body: { error: 'Automatic layout reading is not set up correctly (API key).' } };
    if (e instanceof Anthropic.APIError) {
      console.error('anthropic error', e.status, e.message);
      return { status: 502, body: { error: `The layout reader failed (${e.status}). Please try again.` } };
    }
    if (e instanceof SyntaxError) return { status: 422, body: { error: 'The layout could not be read. Try a clearer photo.' } };
    console.error(e);
    return { status: 500, body: { error: 'Something went wrong while reading the layout.' } };
  }
}
