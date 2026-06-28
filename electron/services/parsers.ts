import * as fs from 'fs';
import * as path from 'path';

/**
 * parsers.ts — extract text from supported files. MVP covers all plain-text /
 * code / data formats (no native deps). .pdf and .docx are a documented
 * fast-follow (add mammoth + pdf-parse, same interface).
 */

export const TEXT_EXT = new Set([
  '.txt', '.md', '.csv', '.json', '.ts', '.tsx', '.js', '.jsx', '.py', '.html', '.css', '.sql', '.yaml', '.yml', '.log',
]);

export function extOf(file: string) {
  return path.extname(file).toLowerCase();
}

export function isSupported(file: string, allowed?: string[]): boolean {
  const ext = extOf(file);
  if (allowed && !allowed.includes(ext)) return false;
  return TEXT_EXT.has(ext);
}

export async function extractText(file: string): Promise<string> {
  if (TEXT_EXT.has(extOf(file))) return fs.readFileSync(file, 'utf-8');
  return '';
}

export default { TEXT_EXT, extOf, isSupported, extractText };
