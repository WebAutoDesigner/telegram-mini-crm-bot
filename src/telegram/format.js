const HTML_ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

const MARKDOWN_V2_SPECIAL = /[_*[\]()~`>#+\-=|{}.!\\]/g;

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (character) => HTML_ESCAPE_MAP[character]);
}

export function escapeMarkdownV2(value) {
  return String(value ?? "").replace(MARKDOWN_V2_SPECIAL, "\\$&");
}

export function lines(...parts) {
  return parts.filter((part) => part !== undefined && part !== null && part !== "").join("\n");
}
