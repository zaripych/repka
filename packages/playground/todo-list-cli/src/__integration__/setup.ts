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
        typescript: '5.2.2',
        '@types/node': '16',
      },
    };
  },
}).create();
