// Bound both the request and response body; proxy HTML errors are not game data.
export async function requestJSON(url, options = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 15000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      cache: 'no-store',
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(
        data?.error ||
          'The game service is temporarily unavailable. Please try again.'
      );
      error.status = response.status;
      throw error;
    }
    if (!data || typeof data !== 'object')
      throw new Error(
        'The game service returned an invalid response. Please try again.'
      );
    return data;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
