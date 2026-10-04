import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface StaticFile {
  body: Buffer;
  contentType: string;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.oga': 'audio/ogg',
  '.mp3': 'audio/mpeg',
};

/** Maps a URL path under root to a file path, or returns undefined if the path is malformed or would leave the root. */
export function resolveStaticPath(
  root: string,
  urlPath: string,
): string | undefined {
  const decoded = decodePath(urlPath);
  if (decoded === undefined || !decoded.startsWith('/')) return undefined;
  const segments = decoded.slice(1).split('/');
  const isSafe = segments.every(
    (segment) => segment !== '' && segment !== '.' && segment !== '..',
  );
  if (!isSafe || /[\0\\]/.test(decoded)) return undefined;
  const resolvedRoot = path.resolve(root);
  const file = path.join(resolvedRoot, ...segments);
  return file.startsWith(`${resolvedRoot}${path.sep}`) ? file : undefined;
}

/** Returns the content type for a known file extension, or undefined so that unknown files are not served. */
export function contentTypeOf(file: string): string | undefined {
  return CONTENT_TYPES[path.extname(file).toLowerCase()];
}

/** Reads a static file under root, or returns undefined if it is not servable. */
export async function readStaticFile(
  root: string,
  urlPath: string,
): Promise<StaticFile | undefined> {
  const file = resolveStaticPath(root, urlPath);
  const contentType = file === undefined ? undefined : contentTypeOf(file);
  if (file === undefined || contentType === undefined) return undefined;
  try {
    return { body: await readFile(file), contentType };
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

function decodePath(urlPath: string): string | undefined {
  try {
    return decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
}

function isNotFound(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'EISDIR';
}
