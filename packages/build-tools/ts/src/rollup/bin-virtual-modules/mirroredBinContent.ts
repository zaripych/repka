import { binPathContent } from './binPathContent';

export const js = String.raw;

export const mirroredBinContent = ({
  binName,
  binScriptPath,
}: {
  binName: string;
  binScriptPath: string;
}) => `import { spawn } from 'node:child_process';
${binPathContent()}

const onError = (err) => {
  console.error(err);
  process.exitCode = 1;
};

binPath('${binName}', '${binScriptPath}').then((result) => {
  const cp = spawn(result, process.argv.slice(2), { stdio: 'inherit' });
  cp.on('error', onError);
  cp.on('close', (code, signal) => {
    if (typeof code === 'number') {
      process.exitCode = code;
    } else if (typeof signal === 'string') {
      console.error('Failed to start', result, signal);
    }
  });
}, onError);
`;
