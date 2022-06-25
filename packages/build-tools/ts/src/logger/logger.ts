import { once } from '../utils/once';

const levels = ['debug', 'info', 'warn', 'error', 'fatal'] as const;

type LogLevel = typeof levels[number];

type Params = Parameters<typeof console.log>;

type Logger = {
  debug(...params: Params): void;
  info(...params: Params): void;
  log(...params: Params): void;
  warn(...params: Params): void;
  error(...params: Params): void;
  fatal(...params: Params): void;
};

const enabledLevelsAfter = (level: LogLevel | 'off') => {
  if (level === 'off') {
    return [];
  }
  const index = levels.findIndex((item) => item === level);
  if (index === -1) {
    throw new Error('Invalid level');
  }
  return levels.slice(index);
};

const isLevel = (level?: string): level is LogLevel => {
  return levels.includes(level as LogLevel);
};

const verbosityOpt = (args = process.argv): LogLevel | 'off' => {
  const index = args.findIndex((value) => value === '--verbosity');
  if (index === -1) {
    return 'info';
  }
  const level = args[index + 1];
  if (level === 'silent' || level === 'off') {
    return 'off';
  }
  if (!isLevel(level)) {
    return 'info';
  }
  return level;
};

const enabledLevels = once(() => enabledLevelsAfter(verbosityOpt()));

const noop = (..._args: Params) => {
  return;
};

const log = (...args: Params) => {
  console.log(...args);
};

const error = (...args: Params) => {
  console.error(...args);
};

const createLogger = (enabled = enabledLevels()) => {
  return levels.reduce(
    (acc, lvl) => {
      return {
        ...acc,
        [lvl]: enabled.includes(lvl)
          ? ['fatal', 'error'].includes(lvl)
            ? error
            : log
          : noop,
      };
    },
    {
      log: enabled.includes('info') ? log : noop,
    } as Logger
  );
};

export const logger: Logger = Object.freeze(createLogger());
