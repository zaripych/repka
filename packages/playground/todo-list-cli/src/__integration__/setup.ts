import { packageInstallTemplate } from '@testing-tools/packages';

await packageInstallTemplate({
  importMetaUrl: import.meta.url,
  packageJson: (json) => {
    return {
      ...json,
      dependencies: {
        ...(typeof json['dependencies'] === 'object'
          ? json['dependencies']
          : undefined),
        typescript: '5.9.3',
        '@types/node': '22',
      },
    };
  },
}).create();
