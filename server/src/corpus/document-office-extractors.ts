import { UnsupportedDocumentError } from './document-extraction-errors';
import type { SafeZipArchive } from './safe-zip';

export const MAX_EXTRACTED_TEXT_CHARS = 10_000_000;

export type OfficeTextResult = {
  text: string;
  truncated: boolean;
};

export function extractOfficeXml(
  format: 'DOCX' | 'ODT',
  archive: SafeZipArchive,
): OfficeTextResult {
  const entryName = format === 'DOCX' ? 'word/document.xml' : 'content.xml';
  const bytes = archive.entries.get(entryName);
  if (!bytes) throw new UnsupportedDocumentError('INVALID_OFFICE_DOCUMENT');
  const xml = decodeXml(bytes);
  return extractXmlText(xml, format);
}

export function extractRtf(content: Buffer): OfficeTextResult {
  const source = new TextDecoder('windows-1252')
    .decode(content)
    .replace(/^\uFEFF/u, '');
  if (!/^\s*\{\\rtf[1-9]/u.test(source)) {
    throw new UnsupportedDocumentError('INVALID_RTF');
  }
  const output: string[] = [];
  const groups: Array<{ skip: boolean; uc: number }> = [{ skip: false, uc: 1 }];
  let length = 0;
  let truncated = false;
  let fallbackRemaining = 0;
  let index = 0;
  let rootClosed = false;

  const consumeBinary = (count: number | undefined) => {
    if (count === undefined || count < 0 || index + count > source.length) {
      throw new UnsupportedDocumentError('INVALID_RTF');
    }
    index += count;
  };

  const append = (value: string) => {
    if (!value || groups[groups.length - 1].skip) return;
    const remaining = MAX_EXTRACTED_TEXT_CHARS - length;
    if (remaining <= 0) {
      truncated = true;
      return;
    }
    if (value.length > remaining) {
      output.push(value.slice(0, remaining));
      length += remaining;
      truncated = true;
      return;
    }
    output.push(value);
    length += value.length;
  };

  while (index < source.length) {
    const character = source[index];
    if (character === '{') {
      if (rootClosed || groups.length >= 256) {
        throw new UnsupportedDocumentError('INVALID_RTF');
      }
      const parent = groups[groups.length - 1];
      groups.push({ skip: parent.skip, uc: parent.uc });
      index += 1;
      continue;
    }
    if (character === '}') {
      if (groups.length === 1)
        throw new UnsupportedDocumentError('INVALID_RTF');
      groups.pop();
      if (groups.length === 1) rootClosed = true;
      index += 1;
      continue;
    }
    if (rootClosed && !/\s/u.test(character)) {
      throw new UnsupportedDocumentError('INVALID_RTF');
    }
    if (character !== '\\') {
      if (!groups[groups.length - 1].skip) {
        if (fallbackRemaining > 0) fallbackRemaining -= 1;
        else if (character !== '\r' && character !== '\n') append(character);
      }
      index += 1;
      continue;
    }

    index += 1;
    if (index >= source.length)
      throw new UnsupportedDocumentError('INVALID_RTF');
    const next = source[index];
    if (next === '*') {
      groups[groups.length - 1].skip = true;
      index += 1;
      continue;
    }
    if (
      next === "'" &&
      /^[0-9a-f]{2}$/iu.test(source.slice(index + 1, index + 3))
    ) {
      const byte = Number.parseInt(source.slice(index + 1, index + 3), 16);
      if (groups[groups.length - 1].skip) {
        index += 3;
        continue;
      }
      if (fallbackRemaining > 0) fallbackRemaining -= 1;
      else append(decodeWindows1252Byte(byte));
      index += 3;
      continue;
    }
    if (!/[A-Za-z]/u.test(next)) {
      if (!groups[groups.length - 1].skip) {
        if (fallbackRemaining > 0) fallbackRemaining -= 1;
        else if (next === '{' || next === '}' || next === '\\') append(next);
        else if (next === '~') append('\u00a0');
        else if (next === '_') append('\u2011');
        else if (next === '-') append('\u00ad');
      }
      index += 1;
      continue;
    }

    const match = /^[A-Za-z]+/u.exec(source.slice(index));
    if (!match) throw new UnsupportedDocumentError('INVALID_RTF');
    const word = match[0].toLowerCase();
    index += match[0].length;
    const parameterMatch = /^-?\d+/u.exec(source.slice(index));
    const parameter = parameterMatch ? Number(parameterMatch[0]) : undefined;
    if (parameterMatch) index += parameterMatch[0].length;
    if (source[index] === ' ') index += 1;

    const group = groups[groups.length - 1];
    if (
      [
        'fonttbl',
        'colortbl',
        'stylesheet',
        'info',
        'pict',
        'object',
        'filetbl',
        'listtable',
        'listoverridetable',
        'generator',
        'xmlopen',
        'xmlattrname',
        'datastore',
      ].includes(word)
    ) {
      group.skip = true;
      continue;
    }
    if (group.skip) {
      if (word === 'bin') consumeBinary(parameter);
      continue;
    }
    if (word === 'uc' && parameter !== undefined) {
      group.uc = Math.max(0, Math.min(16, parameter));
    } else if (word === 'u' && parameter !== undefined) {
      const code = parameter < 0 ? parameter + 65536 : parameter;
      append(String.fromCharCode(code));
      fallbackRemaining = group.uc;
    } else if (word === 'par' || word === 'line') {
      append('\n');
    } else if (word === 'tab') {
      append('\t');
    } else if (word === 'emdash') {
      append('\u2014');
    } else if (word === 'endash') {
      append('\u2013');
    } else if (word === 'bullet') {
      append('\u2022');
    } else if (word === 'lquote') {
      append('\u2018');
    } else if (word === 'rquote') {
      append('\u2019');
    } else if (word === 'ldblquote') {
      append('\u201c');
    } else if (word === 'rdblquote') {
      append('\u201d');
    } else if (word === 'bin') {
      consumeBinary(parameter);
    }
  }

  if (groups.length !== 1) throw new UnsupportedDocumentError('INVALID_RTF');
  return normalizeOutput(output.join(''), truncated);
}

function extractXmlText(xml: string, format: 'DOCX' | 'ODT'): OfficeTextResult {
  if (
    xml.length > 32 * 1024 * 1024 ||
    /<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(xml)
  ) {
    throw new UnsupportedDocumentError('INVALID_OFFICE_XML');
  }

  const output: string[] = [];
  const stack: Array<{
    name: string;
    local: string;
    prefix: string;
    skip: boolean;
  }> = [];
  let length = 0;
  let truncated = false;
  let index = 0;
  let tokens = 0;
  let roots = 0;

  const append = (value: string) => {
    if (!value || stack.some((node) => node.skip)) return;
    const remaining = MAX_EXTRACTED_TEXT_CHARS - length;
    if (remaining <= 0) {
      truncated = true;
      return;
    }
    if (value.length > remaining) {
      output.push(value.slice(0, remaining));
      length += remaining;
      truncated = true;
      return;
    }
    output.push(value);
    length += value.length;
  };

  while (index < xml.length) {
    tokens += 1;
    if (tokens > 1_000_000)
      throw new UnsupportedDocumentError('INVALID_OFFICE_XML');

    if (xml[index] !== '<') {
      const end = xml.indexOf('<', index);
      const rawText = xml.slice(index, end < 0 ? xml.length : end);
      validateXmlEntities(rawText);
      if (stack.length === 0 && rawText.trim()) {
        throw new UnsupportedDocumentError('INVALID_OFFICE_XML');
      }
      if (format === 'DOCX') {
        const current = stack[stack.length - 1];
        if (current?.local === 't' && !stack.some((node) => node.skip)) {
          append(decodeXmlEntities(rawText));
        }
      } else if (
        stack.some((node) => node.prefix === 'text') &&
        !stack.some((node) => node.skip)
      ) {
        append(decodeXmlEntities(rawText));
      }
      index = end < 0 ? xml.length : end;
      continue;
    }

    if (xml.startsWith('<!--', index)) {
      const end = xml.indexOf('-->', index + 4);
      if (end < 0) throw new UnsupportedDocumentError('INVALID_OFFICE_XML');
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', index)) {
      const end = xml.indexOf(']]>', index + 9);
      if (end < 0 || stack.length === 0)
        throw new UnsupportedDocumentError('INVALID_OFFICE_XML');
      if (
        (format === 'DOCX' && stack[stack.length - 1]?.local === 't') ||
        (format === 'ODT' && stack.some((node) => node.prefix === 'text'))
      ) {
        append(xml.slice(index + 9, end));
      }
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<?', index)) {
      const end = xml.indexOf('?>', index + 2);
      if (end < 0) throw new UnsupportedDocumentError('INVALID_OFFICE_XML');
      index = end + 2;
      continue;
    }

    const end = findTagEnd(xml, index + 1);
    if (end < 0) throw new UnsupportedDocumentError('INVALID_OFFICE_XML');
    const token = xml.slice(index + 1, end).trim();
    index = end + 1;
    if (!token || token.startsWith('!')) {
      throw new UnsupportedDocumentError('INVALID_OFFICE_XML');
    }
    validateXmlEntities(token);

    if (token.startsWith('/')) {
      const name = token.slice(1).trim();
      const current = stack.pop();
      if (!current || current.name !== name) {
        throw new UnsupportedDocumentError('INVALID_OFFICE_XML');
      }
      if (format === 'DOCX') {
        if (current.prefix === 'w' && current.local === 'tc') append('\t');
        if (
          current.prefix === 'w' &&
          (current.local === 'p' || current.local === 'tr')
        )
          append('\n');
      } else {
        if (current.prefix === 'table' && current.local === 'table-cell')
          append('\t');
        if (
          (current.prefix === 'text' &&
            (current.local === 'p' || current.local === 'h')) ||
          (current.prefix === 'table' && current.local === 'table-row')
        ) {
          append('\n');
        }
      }
      continue;
    }

    const selfClosing = /\/\s*$/u.test(token);
    const content = selfClosing ? token.replace(/\/\s*$/u, '').trim() : token;
    const nameMatch = /^([A-Za-z_][\w:.-]*)/u.exec(content);
    if (!nameMatch) throw new UnsupportedDocumentError('INVALID_OFFICE_XML');
    const name = nameMatch[1];
    const split = name.indexOf(':');
    const prefix = split < 0 ? '' : name.slice(0, split);
    const local = (split < 0 ? name : name.slice(split + 1)).toLowerCase();
    const parentSkip = stack.some((node) => node.skip);
    const skipHere =
      parentSkip ||
      (format === 'DOCX' &&
        prefix === 'w' &&
        ['del', 'movefrom', 'instrtext'].includes(local)) ||
      (format === 'ODT' &&
        ['annotation', 'tracked-changes', 'script', 'scripts'].includes(local));
    if (stack.length === 0) roots += 1;
    if (stack.length >= 128)
      throw new UnsupportedDocumentError('INVALID_OFFICE_XML');
    stack.push({ name, local, prefix, skip: skipHere });

    if (
      format === 'DOCX' &&
      prefix === 'w' &&
      (local === 'tab' || local === 'ptab')
    )
      append('\t');
    if (format === 'DOCX' && prefix === 'w' && local === 'br') append('\n');
    if (format === 'ODT' && prefix === 'text' && local === 'tab') append('\t');
    if (format === 'ODT' && prefix === 'text' && local === 'line-break')
      append('\n');
    if (format === 'ODT' && prefix === 'text' && local === 's') {
      const countMatch = /\btext:c\s*=\s*["'](\d+)["']/u.exec(content);
      const count = Math.max(1, Math.min(1000, Number(countMatch?.[1] ?? 1)));
      append(' '.repeat(count));
    }

    if (selfClosing) {
      const current = stack.pop()!;
      if (
        format === 'ODT' &&
        current.prefix === 'text' &&
        (current.local === 'p' || current.local === 'h')
      )
        append('\n');
    }
  }

  if (stack.length !== 0 || roots !== 1) {
    throw new UnsupportedDocumentError('INVALID_OFFICE_XML');
  }
  return normalizeOutput(output.join(''), truncated);
}

function findTagEnd(xml: string, start: number) {
  let quote: string | null = null;
  for (let index = start; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return -1;
}

function decodeXml(content: Buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    throw new UnsupportedDocumentError('INVALID_OFFICE_XML');
  }
}

function decodeXmlEntities(value: string) {
  validateXmlEntities(value);
  return value.replace(/&([^;]+);/gu, (_whole, entity: string) => {
    if (entity === 'amp') return '&';
    if (entity === 'lt') return '<';
    if (entity === 'gt') return '>';
    if (entity === 'quot') return '"';
    if (entity === 'apos') return "'";
    const code =
      entity.startsWith('#x') || entity.startsWith('#X')
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
    return String.fromCodePoint(code);
  });
}

function validateXmlEntities(value: string) {
  for (const match of value.matchAll(/&([^;]*);/gu)) {
    const entity = match[1];
    if (['amp', 'lt', 'gt', 'quot', 'apos'].includes(entity)) continue;
    const hexadecimal = /^#x[\da-f]+$/iu.test(entity);
    const decimal = /^#\d+$/u.test(entity);
    if (!hexadecimal && !decimal)
      throw new UnsupportedDocumentError('INVALID_OFFICE_XML');
    const code = hexadecimal
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10);
    if (!isXmlCodePoint(code))
      throw new UnsupportedDocumentError('INVALID_OFFICE_XML');
  }
  if (/&(?![^;]*;)/u.test(value))
    throw new UnsupportedDocumentError('INVALID_OFFICE_XML');
}

function isXmlCodePoint(value: number) {
  return (
    Number.isInteger(value) &&
    (value === 0x09 || value === 0x0a || value === 0x0d || value >= 0x20) &&
    value <= 0x10ffff &&
    !(value >= 0xd800 && value <= 0xdfff)
  );
}

function decodeWindows1252Byte(value: number) {
  const windows1252 = [
    0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030,
    0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c,
    0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d,
    0x17e, 0x178,
  ];
  return String.fromCodePoint(
    value >= 0x80 && value <= 0x9f ? windows1252[value - 0x80] : value,
  );
}

function normalizeOutput(value: string, truncated: boolean): OfficeTextResult {
  return {
    text: value
      .replace(/\r\n?/gu, '\n')
      .replace(/\n\t/gu, '\t')
      .replace(/[ \t]+\n/gu, '\n')
      .replace(/\n{3,}/gu, '\n\n')
      .trim(),
    truncated,
  };
}
