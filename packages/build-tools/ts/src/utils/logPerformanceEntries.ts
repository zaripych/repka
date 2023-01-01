import { EOL } from 'node:os';
import { PerformanceObserver } from 'node:perf_hooks';
import { format } from 'node:util';

export function logPerformanceEntries(): void {
  const observer = new PerformanceObserver((list, observer) => {
    for (const entry of list.getEntriesByType('function')) {
      process.stdout.write(format(entry) + EOL);
    }
    observer.disconnect();
  });
  observer.observe({
    type: 'function',
  });
}
