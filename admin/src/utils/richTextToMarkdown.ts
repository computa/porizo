function normalizeWhitespace(value: string) {
  return value.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

function escapeMarkdownText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/([`*_{}()[\]#+.!>-])/g, '\\$1');
}

function getStyleValue(element: HTMLElement, name: string) {
  const styleAttr = element.getAttribute('style') || '';
  const pattern = new RegExp(`${name}\\s*:\\s*([^;]+)`, 'i');
  const match = styleAttr.match(pattern);
  return match ? match[1].trim().toLowerCase() : '';
}

function isBoldElement(element: HTMLElement) {
  if (['B', 'STRONG'].includes(element.tagName)) return true;
  const weight = getStyleValue(element, 'font-weight');
  return weight === 'bold' || Number.parseInt(weight, 10) >= 600;
}

function isItalicElement(element: HTMLElement) {
  if (['I', 'EM'].includes(element.tagName)) return true;
  return getStyleValue(element, 'font-style') === 'italic';
}

function renderChildren(parent: ParentNode, context: RenderContext) {
  return Array.from(parent.childNodes)
    .map((child) => renderNode(child, context))
    .join('');
}

function ensureTrailingBlankLine(value: string) {
  return value.trim() ? `${value.trim()}\n\n` : '';
}

function collapseInlineWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function renderList(element: HTMLElement, context: RenderContext, ordered: boolean) {
  const items = Array.from(element.children).filter((child) => child.tagName === 'LI');
  if (items.length === 0) return '';

  const lines = items.map((item, index) => {
    const marker = ordered ? `${index + 1}. ` : '- ';
    const rendered = renderChildren(item, { ...context, listDepth: context.listDepth + 1 }).trim();
    const normalized = rendered
      .split('\n')
      .map((line, lineIndex) => (lineIndex === 0 ? `${marker}${line}` : `${' '.repeat(marker.length)}${line}`))
      .join('\n');
    return `${'  '.repeat(context.listDepth)}${normalized}`;
  });

  return `${lines.join('\n')}\n\n`;
}

function renderTable(element: HTMLElement, context: RenderContext) {
  const rows = Array.from(element.querySelectorAll('tr'));
  if (rows.length === 0) return '';

  const matrix = rows.map((row) =>
    Array.from(row.children)
      .filter((child) => child.tagName === 'TH' || child.tagName === 'TD')
      .map((cell) => collapseInlineWhitespace(renderChildren(cell, context).replace(/\|/g, '\\|')))
  ).filter((row) => row.length > 0);

  if (matrix.length === 0) return '';

  const header = matrix[0];
  const body = matrix.slice(1);
  const divider = header.map(() => '---');
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${divider.join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ];

  return `${lines.join('\n')}\n\n`;
}

type RenderContext = {
  listDepth: number;
  preserveWhitespace?: boolean;
};

function renderNode(node: Node, context: RenderContext): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || '';
    return context.preserveWhitespace ? text : escapeMarkdownText(text.replace(/\s+/g, ' '));
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();

  if (['style', 'script', 'meta', 'link', 'xml'].includes(tag)) {
    return '';
  }

  if (tag === 'br') {
    return '\n';
  }

  if (tag === 'hr') {
    return '\n---\n\n';
  }

  if (tag === 'pre') {
    const codeText = element.textContent || '';
    return `\n\`\`\`\n${codeText.trimEnd()}\n\`\`\`\n\n`;
  }

  if (tag === 'code') {
    return `\`${collapseInlineWhitespace(element.textContent || '')}\``;
  }

  if (tag === 'a') {
    const href = element.getAttribute('href') || '';
    const label = collapseInlineWhitespace(renderChildren(element, context)) || href;
    return href ? `[${label}](${href})` : label;
  }

  if (tag === 'img') {
    const alt = element.getAttribute('alt') || '';
    const src = element.getAttribute('src') || '';
    return src ? `![${alt}](${src})` : '';
  }

  if (tag === 'blockquote') {
    const text = renderChildren(element, context)
      .trim()
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    return ensureTrailingBlankLine(text);
  }

  if (tag === 'ul') {
    return renderList(element, context, false);
  }

  if (tag === 'ol') {
    return renderList(element, context, true);
  }

  if (tag === 'table') {
    return renderTable(element, context);
  }

  if (/^h[1-6]$/.test(tag)) {
    const level = Number.parseInt(tag.slice(1), 10);
    const text = collapseInlineWhitespace(renderChildren(element, context));
    return text ? `${'#'.repeat(level)} ${text}\n\n` : '';
  }

  if (tag === 'p') {
    const text = renderChildren(element, context).trim();
    return ensureTrailingBlankLine(text);
  }

  if (tag === 'li') {
    return renderChildren(element, context);
  }

  if (tag === 'span') {
    const content = renderChildren(element, context);
    if (!content.trim()) return content;
    if (isBoldElement(element) && isItalicElement(element)) return `***${content.trim()}***`;
    if (isBoldElement(element)) return `**${content.trim()}**`;
    if (isItalicElement(element)) return `*${content.trim()}*`;
    return content;
  }

  if (tag === 'strong' || tag === 'b') {
    const content = renderChildren(element, context).trim();
    return content ? `**${content}**` : '';
  }

  if (tag === 'em' || tag === 'i') {
    const content = renderChildren(element, context).trim();
    return content ? `*${content}*` : '';
  }

  if (tag === 'div' || tag === 'section' || tag === 'article' || tag === 'header' || tag === 'footer') {
    const content = renderChildren(element, context).trim();
    return ensureTrailingBlankLine(content);
  }

  return renderChildren(element, context);
}

function looksLikeDocx(mimeType?: string, fileName?: string) {
  const normalizedMime = String(mimeType || '').toLowerCase();
  const normalizedName = String(fileName || '').toLowerCase();
  return (
    normalizedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    normalizedName.endsWith('.docx')
  );
}

async function docxToMarkdown(content: ArrayBuffer) {
  const mammoth = await import('mammoth/mammoth.browser');
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: content });
  return htmlToMarkdown(html);
}

export function htmlToMarkdown(html: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const markdown = renderChildren(doc.body, { listDepth: 0 });
  return normalizeWhitespace(markdown)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractMarkdownFromImport(
  content: string | ArrayBuffer,
  mimeType?: string,
  fileName?: string
) {
  if (content instanceof ArrayBuffer) {
    if (!looksLikeDocx(mimeType, fileName)) {
      return '';
    }
    return docxToMarkdown(content);
  }

  const trimmed = String(content || '').trim();
  if (!trimmed) return '';
  const looksLikeHtml =
    /<\/?[a-z][\s\S]*>/i.test(trimmed) ||
    mimeType === 'text/html' ||
    mimeType === 'application/xhtml+xml';
  return looksLikeHtml ? htmlToMarkdown(trimmed) : trimmed.replace(/\r\n/g, '\n').trim();
}
