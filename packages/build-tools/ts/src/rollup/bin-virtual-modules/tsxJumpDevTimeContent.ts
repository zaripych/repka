import { binPathContent } from './binPathContent';

export const tsxJumpDevTimeContent = (
  binName: string
) => `import { spawn } from 'child_process';
${binPathContent()}

const onError = (err) => {
  console.error(err);
  process.exitCode = 1;
};

binPath('tsx', 'tsx/dist/cli.js').then((result) => {
  const cp = spawn(
    process.execPath,
    [
      result,
      fileURLToPath(new URL('../src/bin/${binName}.ts', import.meta.url)),
      ...process.argv.slice(2),
    ],
    { stdio: 'inherit' }
  );
  cp.on('error', onError);
  cp.on('close', (code, signal) => {
    if (typeof code === 'number') {
      process.exitCode = code;
    } else if (typeof signal === 'string') {
      console.error('Failed to start', '${binName}', signal);
    }
  });
}, onError);
`;
