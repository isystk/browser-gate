const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

/** Parses a comma-separated allow list into normalized (trimmed, lowercase) addresses and throws if it is empty or malformed. */
export function parseAllowedEmails(raw: string | undefined): string[] {
  const emails = (raw ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== '');
  if (emails.length === 0) {
    throw new Error('ALLOWED_EMAILS must contain at least one email address');
  }
  if (!emails.every((email) => EMAIL_PATTERN.test(email))) {
    throw new Error('ALLOWED_EMAILS contains an invalid email address');
  }
  return emails;
}

/** Returns true if the email equals one of the allowed addresses (case-insensitive, exact match). */
export function isEmailAllowed(
  email: string,
  allowedEmails: readonly string[],
): boolean {
  return allowedEmails.includes(email.trim().toLowerCase());
}
