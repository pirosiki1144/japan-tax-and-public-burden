import { parse as parseCsv } from "csv-parse/sync";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

function requireContentType(page, accepted) {
  const contentType = page.content_type?.toLowerCase() ?? "";
  if (!accepted.some((value) => contentType.includes(value))) {
    throw new Error(`Source structure changed: unexpected content type ${page.content_type || "missing"}`);
  }
}

function decodeUtf8(page) {
  if (typeof page.body === "string") return page.body;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(page.bytes);
  } catch (error) {
    throw new Error(`Source structure changed: ${page.source_url} is not valid UTF-8`, { cause: error });
  }
}

function htmlText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#37;|&percnt;/gi, "%")
    .replace(/\s+/g, " ")
    .trim();
}

function evidence(page, documentVersion) {
  return {
    source_url: page.source_url,
    final_url: page.final_url,
    fetched_at: page.fetched_at,
    raw_sha256: page.sha256,
    content_type: page.content_type,
    document_version: documentVersion
  };
}

export async function adaptHtmlDocument(page, { documentVersion = "unknown" } = {}) {
  requireContentType(page, ["text/html", "application/xhtml+xml"]);
  const html = decodeUtf8(page);
  const text = htmlText(html);
  if (!text) throw new Error("Source structure changed: HTML contains no readable text");
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return { format: "html", text, title: title ? htmlText(title) : null, evidence: evidence(page, documentVersion) };
}

export async function adaptPdfDocument(page, { documentVersion = "unknown", maxPages = 500 } = {}) {
  requireContentType(page, ["application/pdf"]);
  const bytes = page.bytes instanceof Uint8Array ? page.bytes : new TextEncoder().encode(page.body ?? "");
  if (bytes.length < 5 || new TextDecoder("ascii").decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new Error("Source structure changed: PDF signature is missing");
  }
  const loadingTask = getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: true });
  let document;
  try {
    document = await loadingTask.promise;
    if (document.numPages < 1 || document.numPages > maxPages) {
      throw new Error(`Source structure changed: unexpected PDF page count ${document.numPages}`);
    }
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const pdfPage = await document.getPage(pageNumber);
      const content = await pdfPage.getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/g, " ").trim();
      if (!text) throw new Error(`Source structure changed: PDF page ${pageNumber} contains no readable text`);
      pages.push({ page_number: pageNumber, text });
    }
    return { format: "pdf", page_count: document.numPages, pages, text: pages.map(({ text }) => text).join("\n"), evidence: evidence(page, documentVersion) };
  } catch (error) {
    if (error.message.startsWith("Source structure changed:")) throw error;
    throw new Error(`Source structure changed: PDF is unreadable (${error.message})`, { cause: error });
  } finally {
    if (document) await document.destroy();
    else await loadingTask.destroy();
  }
}

export async function adaptCsvDocument(page, { documentVersion = "unknown", requiredHeaders = [] } = {}) {
  requireContentType(page, ["text/csv", "application/csv", "application/vnd.ms-excel"]);
  let records;
  try {
    records = parseCsv(decodeUtf8(page), { bom: true, columns: true, skip_empty_lines: true, relax_column_count: false });
  } catch (error) {
    throw new Error(`Source structure changed: CSV is unreadable (${error.message})`, { cause: error });
  }
  if (!records.length) throw new Error("Source structure changed: CSV contains no data rows");
  const headers = Object.keys(records[0]);
  const missing = requiredHeaders.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`Source structure changed: CSV headers are missing: ${missing.join(", ")}`);
  return { format: "csv", headers, records, evidence: evidence(page, documentVersion) };
}

export async function adaptOfficialDocument(format, page, options = {}) {
  if (format === "html") return adaptHtmlDocument(page, options);
  if (format === "pdf") return adaptPdfDocument(page, options);
  if (format === "csv") return adaptCsvDocument(page, options);
  throw new Error(`Unsupported official document format: ${format}`);
}
