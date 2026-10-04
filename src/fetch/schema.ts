import { z } from 'zod';

import { AppError } from '../lib/errors.js';
import { ID_PATTERN } from '../lib/patterns.js';

export const OUTPUT_KINDS = ['html', 'text', 'screenshot'] as const;
export const SCROLL_TARGETS = ['top', 'bottom'] as const;

export const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_URL_LENGTH = 2_048;
const MAX_SELECTOR_LENGTH = 500;
const MAX_STEPS = 20;
const MAX_EXTRACT_ENTRIES = 20;
const MAX_CREDENTIAL_LENGTH = 256;
const EXTRACT_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
// Playwright の別セレクタエンジン（xpath= / text= / internal: 等）や `>>` 連結を拒否し、CSS だけを通す
const SELECTOR_ENGINE_PATTERN = /^\s*(?:[a-z][a-z-]*=|\/\/|\.\.\/|internal:)/i;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_PATTERN = /[\u0000-\u001f\u007f]/;

const selectorSchema = z
  .string()
  .min(1)
  .max(MAX_SELECTOR_LENGTH)
  .refine(
    (value) =>
      !SELECTOR_ENGINE_PATTERN.test(value) &&
      !value.includes('>>') &&
      !CONTROL_CHARS_PATTERN.test(value),
  );

const stepSchema = z.union([
  z.strictObject({ wait_for: selectorSchema }),
  z.strictObject({ click: selectorSchema }),
  z.strictObject({ scroll: z.enum(SCROLL_TARGETS) }),
]);

const proxySchema = z.strictObject({
  server: z.string().min(1).max(MAX_URL_LENGTH),
  username: z.string().max(MAX_CREDENTIAL_LENGTH).optional(),
  password: z.string().max(MAX_CREDENTIAL_LENGTH).optional(),
});

const fetchRequestSchema = z
  .strictObject({
    url: z.string().min(1).max(MAX_URL_LENGTH),
    profile: z.string().regex(ID_PATTERN).optional(),
    outputs: z.array(z.enum(OUTPUT_KINDS)).max(OUTPUT_KINDS.length).optional(),
    extract: z
      .record(z.string().regex(EXTRACT_NAME_PATTERN), selectorSchema)
      .refine((value) => Object.keys(value).length <= MAX_EXTRACT_ENTRIES)
      .optional(),
    steps: z.array(stepSchema).max(MAX_STEPS).optional(),
    proxy: proxySchema.optional(),
    timeout_ms: z
      .number()
      .int()
      .min(MIN_TIMEOUT_MS)
      .max(MAX_TIMEOUT_MS)
      .optional(),
    full_page: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.outputs === undefined ||
      value.outputs.length > 0 ||
      value.extract !== undefined,
  );

export type FetchRequest = z.infer<typeof fetchRequestSchema>;
export type FetchStep = z.infer<typeof stepSchema>;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

/** Validates an untrusted request body and throws INVALID_REQUEST without echoing submitted values. */
export function parseFetchRequest(raw: unknown): FetchRequest {
  const result = fetchRequestSchema.safeParse(raw);
  if (result.success) return result.data;
  const path = result.error.issues[0]?.path[0]?.toString() ?? '';
  throw new AppError(
    'INVALID_REQUEST',
    `Invalid request${path === '' ? '' : ` at "${path}"`}`,
  );
}

/** Returns the outputs to produce: the requested ones, or html when neither outputs nor extract is given. */
export function resolveOutputs(request: FetchRequest): readonly OutputKind[] {
  if (request.outputs !== undefined) return request.outputs;
  return request.extract === undefined ? ['html'] : [];
}
