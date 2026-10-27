import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, realpathSync, existsSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';

export class BridgeError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}
export function requireValue(condition, code, message, details) { if (!condition) throw new BridgeError(code, message, details); }
export const hash = value => createHash('sha256').update(value).digest('hex');
export const id = prefix => `${prefix}-${randomUUID()}`;
export const json = value => JSON.stringify(value);
export const parse = value => value == null ? null : JSON.parse(value);
export function directory(path) { mkdirSync(path, { recursive: true }); return path; }
export function inside(root, ...parts) {
  const base = resolve(root); const target = resolve(base, ...parts); const rel = relative(base, target);
  requireValue(rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)), 'invalid_path', '路径超出插件数据目录');
  // Reject symlink/junction escapes, including through an existing ancestor.
  let parent = target;
  while (!existsSync(parent)) { const next = dirname(parent); if (next === parent) break; parent = next; }
  if (existsSync(parent) && existsSync(base)) {
    const actual = relative(realpathSync(base), realpathSync(parent));
    requireValue(actual === '' || (!actual.startsWith('..') && !isAbsolute(actual)), 'invalid_path', '不允许目录链接逃逸');
  }
  return target;
}
export function atomicFile(path, bytes) {
  directory(dirname(path)); const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, bytes); renameSync(temp, path);
}
export function writeJson(path, value) { atomicFile(path, JSON.stringify(value, null, 2) + '\n'); }
export function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
export const estimateTokens = text => Math.ceil((String(text).match(/[\u3400-\u9fff]/gu)?.length ?? 0) * 1.15 + String(text).replace(/[\u3400-\u9fff]/gu, '').length / 3);
export function publicError(error) {
  return { code: error?.code || 'internal_error', message: error instanceof BridgeError ? error.message : '操作未完成，原文和已完成数据已保留。', details: error instanceof BridgeError ? error.details : {} };
}
export function mergeRrf(lists, limit = 5) {
  const scores = new Map(); const items = new Map();
  for (const list of lists) list.forEach((item, i) => { scores.set(item.id, (scores.get(item.id) || 0) + 1 / (60 + i)); items.set(item.id, item); });
  return [...scores].sort((a,b) => b[1] - a[1]).slice(0,limit).map(([key, score]) => ({ ...items.get(key), score }));
}
