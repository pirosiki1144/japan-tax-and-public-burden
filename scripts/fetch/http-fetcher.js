import { createHash } from "node:crypto";

const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export class SourceFetchError extends Error {
  constructor(message, { code, sourceUrl, retryable = false, attempts = 1, cause } = {}) {
    super(message, { cause });
    this.name = "SourceFetchError";
    this.code = code;
    this.sourceUrl = sourceUrl;
    this.retryable = retryable;
    this.attempts = attempts;
  }
}

async function fetchWithRetry(sourceUrl, options, { fetchImpl, retryAttempts, sleep, timeoutMs }) {
  let lastError;
  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(sourceUrl, { ...options, signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) return response;
      const retryable = TRANSIENT_STATUSES.has(response.status);
      lastError = new SourceFetchError(`Fetch failed (${response.status}) for ${sourceUrl}`, {
        code: retryable ? "url_transient_failure" : "url_permanent_failure",
        sourceUrl,
        retryable,
        attempts: attempt
      });
      if (!retryable) throw lastError;
    } catch (error) {
      if (error instanceof SourceFetchError && !error.retryable) throw error;
      lastError = error instanceof SourceFetchError ? error : new SourceFetchError(`Fetch failed for ${sourceUrl}: ${error.message}`, {
        code: "url_transient_failure", sourceUrl, retryable: true, attempts: attempt, cause: error
      });
    }
    if (attempt < retryAttempts) await sleep(250 * (2 ** (attempt - 1)));
  }
  throw new SourceFetchError(`${lastError.message} after ${retryAttempts} attempts`, {
    code: lastError.code, sourceUrl, retryable: lastError.retryable, attempts: retryAttempts, cause: lastError
  });
}

export async function fetchSourcePages(source, { fetchImpl = globalThis.fetch, now = () => new Date(), timeoutMs = 30000, retryAttempts = 3, sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) } = {}) {
  const pages = [];
  for (const sourceUrl of source.entry_urls) {
    const response = await fetchWithRetry(sourceUrl, {
      headers: { "user-agent": "japan-tax-and-public-burden/0.1 (+https://github.com/pirosiki1144/japan-tax-and-public-burden)" }
    }, { fetchImpl, retryAttempts, sleep, timeoutMs });
    const finalUrl = response.url || sourceUrl;
    if (new URL(finalUrl).origin !== new URL(source.base_url).origin) throw new SourceFetchError(`Unexpected redirect origin for ${sourceUrl}: ${finalUrl}`, { code: "url_unexpected_redirect", sourceUrl });
    const contentType = response.headers.get("content-type") ?? "";
    const acceptedContentTypes = source.accepted_content_types ?? ["text/html"];
    if (!acceptedContentTypes.some((accepted) => contentType.toLowerCase().includes(accepted.toLowerCase()))) {
      throw new SourceFetchError(`Unexpected content type for ${sourceUrl}: ${contentType || "missing"}`, { code: "source_structure_changed", sourceUrl });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0) throw new SourceFetchError(`Empty response for ${sourceUrl}`, { code: "source_structure_changed", sourceUrl });
    let body;
    try {
      body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      throw new SourceFetchError(`Response is not valid UTF-8 for ${sourceUrl}`, { code: "source_structure_changed", sourceUrl, cause: error });
    }
    pages.push({
      source_url: sourceUrl,
      final_url: finalUrl,
      fetched_at: now().toISOString(),
      content_type: contentType,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      body
    });
  }
  return pages;
}
