import type { JsonType } from './packageJson';
import { dependencyKeys } from './packageJson';

export function dependencyVersionFromPackageJson(
  name: string,
  packageJson: Record<string, JsonType>
) {
  const recordByKey = dependencyKeys.map((key) => {
    const record = packageJson[key];
    if (typeof record === 'object' && record) {
      return record;
    }
    return {};
  });
  const record = recordByKey.find((record) => Boolean(record[name]));
  const version = record?.[name];
  if (typeof version === 'string') {
    return version;
  } else {
    return undefined;
  }
}
