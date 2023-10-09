import { packageInstallTemplate } from '@testing-tools/packages';

await packageInstallTemplate({
  importMetaUrl: import.meta.url,
}).create();
