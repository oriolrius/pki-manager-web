/** Read the diagnostic text attached to a failed synchronous child process. */
export function processOutput(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const stdout = 'stdout' in error ? error.stdout : '';
  const stderr = 'stderr' in error ? error.stderr : '';
  return `${stdout || ''}${stderr || ''}`;
}
