/**
 * Values of the certificate form, as the backend wants them.
 *
 * The backend checks a name or an address as given and refuses whitespace at
 * the ends (it puts the value in the certificate without a change). A value
 * typed or pasted in the form often has a space or a line break at an end, so
 * the form removes it before it sends the request.
 */

/** Trim each entry and drop the empty ones. `undefined` when no entry is left. */
export function cleanSanList(values: readonly string[]): string[] | undefined {
  const cleaned = values.map((value) => value.trim()).filter((value) => value !== '');
  return cleaned.length > 0 ? cleaned : undefined;
}
