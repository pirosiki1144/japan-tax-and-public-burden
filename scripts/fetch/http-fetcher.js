import { createHash } from "node:crypto";

export async function fetchSourcePages(source, { fetchImpl = globalThis.fetch, now = () => new Date(), timeoutMs = 30000 } = {}) {
  const pages = [];
  for (const sourceUrl of source.entry_urls) {
    const response = await fetchImpl(sourceUrl, {
      headers: { "user-agent": "japan-tax-and-public-burden/0.1 (+https://github.com/pirosiki1144/japan-tax-and-public-burden)" },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) throw new Error(`Fetch failed (${response.status}) for ${sourceUrl}`);
    const finalUrl = response.url || sourceUrl;
    if (new URL(finalUrl).origin !== new URL(source.base_url).origin) throw new Error(`Unexpected redirect origin for ${sourceUrl}: ${finalUrl}`);
    const contentType = response.headers.get("content-type") ?? "";
    const acceptedContentTypes = source.accepted_content_types ?? ["text/html"];
    if (!acceptedContentTypes.some((accepted) => contentType.toLowerCase().includes(accepted.toLowerCase()))) {
      throw new Error(`Unexpected content type for ${sourceUrl}: ${contentType || "missing"}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0) throw new Error(`Empty response for ${sourceUrl}`);
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
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
