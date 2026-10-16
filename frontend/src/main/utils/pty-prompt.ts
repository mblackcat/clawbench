/**
 * Conservative "waiting for the user" heuristic on the last output line of a
 * TUI: explicit y/n or numbered-choice prompts, or a short question that opens
 * like a confirmation ("Do you want…?", "Allow…?"). A bare trailing '?' is not
 * enough — assistants end ordinary answers with questions all the time.
 */
export function looksLikePtyPrompt(output: string): boolean {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const last = lines[lines.length - 1] ?? ''
  if (!last || last.length > 200) return false
  if (/[([]\s*y(?:es)?\s*\/\s*n(?:o)?\s*[)\]]\s*:?\s*$/i.test(last)) return true
  if (/\[\s*1\s*-\s*\d+\s*\]\s*:?\s*$/.test(last)) return true
  if (
    /^(?:[>?❯›»]\s*)?(?:do you want|would you like|shall i|should i|allow|approve|proceed|continue|confirm|overwrite|replace|trust)\b.*\?\s*$/i.test(last)
  ) {
    return true
  }
  if (/^(?:是否|确认|允许).{0,60}[？?]\s*$/.test(last)) return true
  return false
}
