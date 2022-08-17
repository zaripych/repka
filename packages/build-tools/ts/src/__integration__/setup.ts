import { packageInstallTemplate } from '@testing-tools/packages';

await packageInstallTemplate({
  importMetaUrl: import.meta.url,
  buildTasks: ['build:tools', 'declarations'],
  packageUnderTestDependencyType: 'dependencies',
  templateName: 'solo-template',
}).create();
