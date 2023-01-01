import { packageInstallTemplate } from '@testing-tools/packages';

// import { lookupPackageVersions } from '../package-json/lookupPackageVersions';

const templateSolo = packageInstallTemplate({
  importMetaUrl: import.meta.url,
  templateName: 'template-solo',
  buildTasks: ['build:tools', 'declarations'],
  packageUnderTestDependencyType: 'devDependencies',
  linkPackageUnderTest: true,
});

// const templateMono = packageInstallTemplate({
//   importMetaUrl: import.meta.url,
//   templateName: 'template-mono',
//   buildTasks: [],
//   packageUnderTestDependencyType: 'devDependencies',
//   linkPackageUnderTest: true,
//   copyFiles: [
//     {
//       source: './template-mono',
//       include: ['**/*'],
//     },
//   ],
//   packageJson: async (
//     entries: Record<string, unknown>,
//     _path: string,
//     { packageUnderTestDependency }
//   ) => {
//     if (entries['name'] === 'package-a') {
//       return {
//         ...entries,
//         devDependencies: {},
//       };
//     } else {
//       return {
//         workspaces: ['packages/*'],
//         ...entries,
//         devDependencies: await lookupPackageVersions(
//           Object.fromEntries([
//             packageUnderTestDependency,
//             ['@jest/globals', 'lookup:from-our-package-json'],
//           ])
//         ),
//       };
//     }
//   },
// });

await templateSolo
  .runBuild()
  .then(() => Promise.all([templateSolo.create() /* templateMono.create() */]))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
