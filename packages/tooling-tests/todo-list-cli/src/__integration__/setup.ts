import { packageInstallTemplate } from '@testing-tools/packages';

await packageInstallTemplate({
  packageJson: (json) => {
    return {
      ...json,
      dependencies: {
        ...(typeof json['dependencies'] === 'object'
          ? json['dependencies']
          : undefined),
        typescript: '4.7.3',
        '@types/node': '16',
      },
    };
  },
}).create();
