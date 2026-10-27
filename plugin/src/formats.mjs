import * as deepseek from './importer.mjs';
import {requireValue} from './util.mjs';

// Adapters own export syntax; persistence, reconstruction and memory do not.
export const adapters = new Map([['deepseek-web', deepseek]]);
export function adapter(format = 'deepseek-web') {
  const selected = adapters.get(format);
  requireValue(selected, 'unsupported_format', '暂不支持该导出格式');
  return selected;
}
