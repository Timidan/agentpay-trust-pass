const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export type BoundedJsonOptions = {
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
};

export async function fetchBoundedJson<T = unknown>(
  url: string | URL,
  init: RequestInit = {},
  options: BoundedJsonOptions = {}
): Promise<{ response: Response; body: T }> {
  const { response, bytes } = await fetchBounded(url, init, options);
  try {
    return {
      response,
      body: JSON.parse(new TextDecoder().decode(bytes)) as T
    };
  } catch (error) {
    throw new Error("HTTP response was not valid JSON", { cause: error });
  }
}

export async function fetchBoundedText(
  url: string | URL,
  init: RequestInit = {},
  options: BoundedJsonOptions = {}
): Promise<{ response: Response; body: string }> {
  const { response, bytes } = await fetchBounded(url, init, options);
  return { response, body: new TextDecoder().decode(bytes) };
}

async function fetchBounded(
  url: string | URL,
  init: RequestInit,
  options: BoundedJsonOptions
): Promise<{ response: Response; bytes: Uint8Array }> {
  const timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "HTTP timeout");
  const maximum = positiveInteger(
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    "HTTP response limit"
  );
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(url, {
      ...init,
      redirect: "error",
      signal
    });
  } catch (error) {
    if (timeoutSignal.aborted && !init.signal?.aborted) {
      throw new Error(`HTTP request timed out after ${timeoutMs}ms`, { cause: error });
    }
    throw error;
  }

  return { response, bytes: await readBoundedBody(response, maximum) };
}

async function readBoundedBody(response: Response, maximum: number): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && /^[0-9]+$/.test(contentLength) && BigInt(contentLength) > BigInt(maximum)) {
    await response.body?.cancel();
    throw responseTooLarge(maximum);
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        throw responseTooLarge(maximum);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function responseTooLarge(maximum: number): Error {
  return new Error(`HTTP response exceeds ${maximum} bytes`);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}
