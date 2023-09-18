import { escapeRegExp } from '@utils/ts';
import { extname } from 'path';

export function changeExtension(path: string, newExtension: string) {
  const ext = extname(path);
  if (!ext) {
    return path;
  }

  return path.replaceAll(
    new RegExp(escapeRegExp(extname(path)) + '$', 'g'),
    newExtension
  );
}
