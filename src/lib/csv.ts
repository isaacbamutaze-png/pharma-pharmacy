/** Minimal RFC-4180 CSV writer + browser download helper (works offline). */

export function toCsv(rows: Array<Array<string | number | boolean | null | undefined>>): string {
  const cell = (v: string | number | boolean | null | undefined): string => {
    let s = v === null || v === undefined ? "" : String(v);
    // Neutralise spreadsheet formula injection (=, +, -, @ at the start).
    if (/^[=+\-@]/.test(s) && Number.isNaN(Number(s))) s = "'" + s;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadCsv(
  filename: string,
  rows: Array<Array<string | number | boolean | null | undefined>>,
): void {
  // BOM so Excel opens UTF-8 correctly.
  downloadFile(filename, "﻿" + toCsv(rows), "text/csv;charset=utf-8");
}
