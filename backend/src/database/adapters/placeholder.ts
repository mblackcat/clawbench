/**
 * Convert MySQL / SQLite style `?` placeholders to PostgreSQL `$1, $2, …`
 * positional parameters.
 *
 * Handles:
 *  - `?` outside of string literals
 *  - Single-quoted string literals (skipped)
 *
 * This is intentionally simple — the app never generates SQL with
 * embedded single-quoted question marks, so a lightweight pass is sufficient.
 */
export function toPositionalParams(sql: string): string {
  let idx = 0;
  let inString = false;
  let result = '';

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (ch === "'" && sql[i - 1] !== '\\') {
      inString = !inString;
      result += ch;
    } else if (ch === '?' && !inString) {
      idx++;
      result += `$${idx}`;
    } else {
      result += ch;
    }
  }

  return result;
}
