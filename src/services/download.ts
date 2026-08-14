/**
 * Saving a file to the user's device.
 *
 * A blob URL and a synthetic click - the same approach the original application
 * used, and still the right one: entirely local, no server, no dependency.
 */

export function downloadText(filename: string, contents: string, mime: string): void {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Freed on the next turn of the event loop: revoking synchronously can cancel
  // the download in some browsers before it has started reading the blob.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

/** Reads a user-selected file as text, bounded so a huge file cannot hang the tab. */
export function readFileAsText(file: File, maxBytes: number): Promise<string> {
  if (file.size > maxBytes) {
    return Promise.reject(
      new Error(
        `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB, which is larger than the ` +
          `${String(Math.round(maxBytes / 1024 / 1024))} MB limit.`,
      ),
    );
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = () => {
      reject(new Error('The file could not be read. It may have been moved or is unreadable.'));
    };
    reader.readAsText(file);
  });
}

/**
 * Escapes one CSV field.
 *
 * A leading `=`, `+`, `-` or `@` is prefixed with an apostrophe: spreadsheet
 * software would otherwise treat the cell as a formula, which turns an item
 * innocently named "=Rice" into a spreadsheet injection when the export is
 * opened. The apostrophe is the standard, non-destructive defence.
 */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';

  // Narrowed rather than `String(value)`: an object would otherwise become the
  // literal text "[object Object]" in an exported spreadsheet, which looks like
  // data and is not.
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
        ? String(value)
        : JSON.stringify(value);

  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [headers.map(csvField).join(',')];
  for (const row of rows) lines.push(row.map(csvField).join(','));
  // A byte-order mark, so Excel opens the file as UTF-8. Without it "Água"
  // arrives as "Ãgua". Written as an escape because the literal character is
  // invisible in an editor and looks like a stray byte.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
