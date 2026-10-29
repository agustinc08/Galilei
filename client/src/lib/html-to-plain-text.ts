const BLOCK_ELEMENTS = new Set([
  "ADDRESS", "ARTICLE", "BLOCKQUOTE", "DD", "DIV", "DL", "DT", "FIGCAPTION", "FIGURE",
  "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "LI", "MAIN", "OL", "P",
  "PRE", "SECTION", "TABLE", "TR", "UL",
]);

const OMIT_ELEMENTS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

export function normalizeLegacyBreaks(value: string): string {
  return value.replace(/<br\s*\/?>|&lt;br\s*(?:\/)?&gt;/giu, "\n");
}

function collectText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return normalizeLegacyBreaks(node.textContent ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return "";

  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : null;
  const tagName = element?.tagName ?? "";
  if (OMIT_ELEMENTS.has(tagName)) return "";
  if (tagName === "BR") return "\n";

  const content = Array.from(node.childNodes, collectText).join("");
  if (tagName === "LI") return `• ${content.trim()}\n`;
  return BLOCK_ELEMENTS.has(tagName) ? `\n${content}\n` : content;
}

/** Render legacy summary markup as inert, readable text. Markup is never inserted into the live page. */
export function htmlToPlainText(value: string | null | undefined): string {
  if (!value?.trim()) return "";

  const inertTemplate = document.createElement("template");
  inertTemplate.innerHTML = value;
  const text = collectText(inertTemplate.content)
    .replace(/\u00a0/gu, " ")
    .replace(/[\t\f\v ]+\n/gu, "\n")
    .replace(/\n[\t\f\v ]+/gu, "\n")
    .replace(/[\t\f\v ]{2,}/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

  return text;
}
