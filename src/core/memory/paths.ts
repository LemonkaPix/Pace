import { posix } from 'node:path';
import { z } from 'zod';

export function memoryPath(value: string): string {
  const path = value.replace(/^\.\//, '').replace(/\/$/, '');
  if (!path || path.length > 300 || path.startsWith('/') || path.includes('\\') || /[\x00-\x1f:*?]/.test(path) || path.split('/').some(part => !part || part === '..' || part === '.' || part === '.git') || posix.normalize(path) !== path)
    throw new Error('Memory paths must be explicit repository-relative files or directories, without traversal or globs');
  return path;
}
export const memoryPathsSchema = z.array(z.string().transform(memoryPath)).max(5).transform(paths => [...new Set(paths)].sort());
export function pathsInMemoryQuery(query: string): string[] {
  // Only explicit paths, not inferred modules or a second task classifier.
  return [...new Set(query.split(/[\s`"'<>()[\]{},;]+/).flatMap(token => {
    const candidate = token.replace(/:\d+(?::\d+)?$/, '').replace(/[.!?]+$/, '');
    if (!candidate.includes('/') && !/\.[a-zA-Z0-9]{1,10}$/.test(candidate)) return [];
    try { return [memoryPath(candidate)]; } catch { return []; }
  }))].slice(0, 5);
}
export const relatedMemoryPath = (target: string, focus: string) => target === focus || focus.startsWith(target + '/') || target.startsWith(focus + '/');
