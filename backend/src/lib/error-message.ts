/** Extract the message from a thrown Error or an error-like object. */
export function errorMessage(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return undefined;
}
