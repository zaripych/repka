import { packageInstallTemplate } from '@testing-tools/packages';

await packageInstallTemplate({
  buildTasks: ['build:tools', 'declarations'],
}).create();
