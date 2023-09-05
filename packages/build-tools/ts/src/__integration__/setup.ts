import { packageInstallTemplate } from '@testing-tools/packages';

const templateSolo = packageInstallTemplate({
  importMetaUrl: import.meta.url,
  templateName: 'template-solo',
  buildTasks: ['build:tools', 'declarations'],
  packageUnderTestDependencyType: 'devDependencies',
});

await templateSolo
  .runBuild()
  .then(() => Promise.all([templateSolo.create()]))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
