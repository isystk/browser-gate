/** Parses a Cookie request header into a name-value map without a prototype. The first occurrence of a name wins. */
export function parseCookieHeader(
  header: string | undefined,
): Record<string, string> {
  const cookies: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  if (header === undefined) return cookies;
  for (const [name, value] of header.split(';').flatMap(parsePair)) {
    cookies[name] ??= value;
  }
  return cookies;
}

function parsePair(part: string): [string, string][] {
  const separator = part.indexOf('=');
  if (separator < 1) return [];
  const name = part.slice(0, separator).trim();
  if (name === '') return [];
  return [[name, decodeValue(part.slice(separator + 1).trim())]];
}

function decodeValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
