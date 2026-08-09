/**
 * @file
 * @author Tomáš Chochola <tomaschochola@tomaschochola.cz>
 * @copyright © 2026 Tomáš Chochola <tomaschochola@tomaschochola.cz>
 *
 * @license CC-BY-ND-4.0
 *
 * @see {@link https://creativecommons.org/licenses/by-nd/4.0/} License
 * @see {@link https://github.com/tomaschochola} GitHub Profile
 * @see {@link https://github.com/sponsors/tomaschochola} GitHub Sponsors
 */

const lineBreaks = Object.freeze({
  cr: '\r',
  crlf: '\r\n',
  lf: '\n',
});

function splitLines(text) {
  const lines = [];
  const pattern = /\r\n|\r|\n/gu;

  let start = 0;

  for (const match of text.matchAll(pattern)) {
    lines.push({
      content: text.slice(start, match.index),
      lineBreak: match[0],
    });
    start = match.index + match[0].length;
  }

  lines.push({
    content: text.slice(start),
    lineBreak: '',
  });

  return lines;
}

function trailingWhitespaceStart(content) {
  return content.trimEnd().length;
}

function finalContentIndex(lines) {
  let index = lines.length - 1;

  while (index >= 0 && lines[index].content === '') {
    index -= 1;
  }

  return index;
}

function finalNewlineDiagnostic(lines, insertFinalNewline) {
  if (insertFinalNewline === undefined) {
    return undefined;
  }

  const contentIndex = finalContentIndex(lines);

  if (contentIndex === -1) {
    return lines.some(({ lineBreak }) => lineBreak !== '')
      ? {
          location: 'EOF',
          message: insertFinalNewline ? 'extra final newlines' : 'unexpected final newline',
        }
      : undefined;
  }

  if (lines[contentIndex].lineBreak === '') {
    return insertFinalNewline
      ? {
          location: 'EOF',
          message: 'missing final newline',
        }
      : undefined;
  }

  if (!insertFinalNewline) {
    return {
      location: 'EOF',
      message: 'unexpected final newline',
    };
  }

  return lines.length > contentIndex + 2
    ? {
        location: 'EOF',
        message: 'extra final newlines',
      }
    : undefined;
}

function inferredFinalLineBreak(lines) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].lineBreak !== '') {
      return lines[index].lineBreak;
    }
  }

  return '\n';
}

function normalizeFinalNewline(lines, insertFinalNewline, configuredLineBreak) {
  const contentIndex = finalContentIndex(lines);

  if (contentIndex === -1) {
    lines.length = 1;
    lines[0] = { content: '', lineBreak: '' };

    return;
  }

  const finalLineBreak = configuredLineBreak ?? inferredFinalLineBreak(lines);

  lines.length = contentIndex + 1;
  lines[contentIndex].lineBreak = insertFinalNewline ? finalLineBreak : '';
}

export function normalizeText(text, settings) {
  const lines = splitLines(text);
  const configuredLineBreak = settings.endOfLine === undefined ? undefined : lineBreaks[settings.endOfLine];
  const diagnostics = [];

  for (const [index, line] of lines.entries()) {
    const whitespaceStart = trailingWhitespaceStart(line.content);

    if (settings.trimTrailingWhitespace === true && whitespaceStart !== line.content.length) {
      diagnostics.push({
        location: index + 1,
        message: 'trailing whitespace',
      });
      line.content = line.content.slice(0, whitespaceStart);
    }

    if (configuredLineBreak !== undefined && line.lineBreak !== '' && line.lineBreak !== configuredLineBreak) {
      diagnostics.push({
        location: index + 1,
        message: `expected ${settings.endOfLine.toUpperCase()} line ending`,
      });
      line.lineBreak = configuredLineBreak;
    }
  }

  const newlineDiagnostic = finalNewlineDiagnostic(lines, settings.insertFinalNewline);

  if (newlineDiagnostic !== undefined) {
    diagnostics.push(newlineDiagnostic);
  }

  if (settings.insertFinalNewline !== undefined) {
    normalizeFinalNewline(lines, settings.insertFinalNewline, configuredLineBreak);
  }

  return {
    diagnostics,
    text: lines.map(({ content, lineBreak }) => `${content}${lineBreak}`).join(''),
  };
}
