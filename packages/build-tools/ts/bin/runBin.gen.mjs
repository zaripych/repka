// This file is bundled up from './src/*' and needs to be committed
import { spawn } from 'child_process';
import 'console';
import assert from 'assert';

function once(fn) {
  let value;
  let calculated = false;
  return () => {
    if (calculated) {
      return value;
    }
    value = fn();
    calculated = true;
    return value;
  };
}

const determineMonorepoRoot = (candidate) => {
  const result = /(.*(?=\/packages\/))|(.*(?=\/node_modules\/))|(.*)/.exec(candidate);
  assert(!!result);
  const [, packagesRoot, nodeModulesRoot, entirePath] = result;
  const rootPath = packagesRoot || nodeModulesRoot || entirePath;
  assert(!!rootPath);
  return rootPath;
};
const guessMonorepoRoot = once(() => {
  return determineMonorepoRoot(process.env["INIT_CWD"] || process.cwd());
});

function captureStackTrace(remove = 0) {
  const stackContainer = {
    stack: ""
  };
  Error.captureStackTrace(stackContainer);
  const stackTrace = stackContainer.stack.split("\n").slice(6 + remove).join("\n");
  return {
    stackTrace,
    prepareForRethrow: (err) => {
      const oldStackTrace = err.stack ?? "".split("\n").slice(1).join("\n");
      err.stack = `${err.name || "Error"}: ${err.message}
${oldStackTrace}
${stackTrace}`;
      return err;
    }
  };
}

async function spawnToPromise(child, opts) {
  const { prepareForRethrow } = captureStackTrace();
  const exitCodes = (opts == null ? void 0 : opts.exitCodes) || [0];
  const cwd = guessMonorepoRoot();
  console.log([">", child.spawnfile, ...child.spawnargs.slice(1)].map((entry) => entry.replace(cwd + "/", "./")).join(" "), ...(opts == null ? void 0 : opts.cwd) ? [`in ${opts.cwd}`] : []);
  await new Promise((res, rej) => child.on("close", (code, signal) => {
    if (typeof code === "number") {
      if (exitCodes !== "any" && !exitCodes.includes(code)) {
        rej(prepareForRethrow(new Error(`Process has failed with code ${code}`)));
      } else {
        res();
      }
    } else if (signal) {
      rej(prepareForRethrow(new Error(`Failed to execute process: ${signal}`)));
    } else {
      throw prepareForRethrow(new Error("Expected signal or error code"));
    }
  }).on("error", rej));
  if (typeof child.exitCode === "number" && typeof process.exitCode !== "number") {
    process.exitCode = child.exitCode;
  }
}

const binPath = (bin) => new URL(`../node_modules/.bin/${bin}`, import.meta.url).pathname;
async function runBin(bin, args = process.argv.slice(2)) {
  await spawnToPromise(spawn(binPath(bin), args, {
    stdio: "inherit"
  }), {
    exitCodes: "any"
  });
}

export { runBin as r, spawnToPromise as s };
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicnVuQmluLmdlbi5tanMiLCJzb3VyY2VzIjpbIi4uL3NyYy91dGlscy9vbmNlLnRzIiwiLi4vc3JjL2ZpbGUtc3lzdGVtL2d1ZXNzTW9ub3JlcG9Sb290LnRzIiwiLi4vc3JjL3V0aWxzL3N0YWNrVHJhY2UudHMiLCIuLi9zcmMvY2hpbGQtcHJvY2Vzcy9zcGF3blRvUHJvbWlzZS50cyIsIi4uL3NyYy9iaW4vcnVuQmluLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImV4cG9ydCBmdW5jdGlvbiBvbmNlPFQ+KGZuOiAoKSA9PiBUKTogKCkgPT4gVCB7XG4gIGxldCB2YWx1ZTogVDtcbiAgbGV0IGNhbGN1bGF0ZWQgPSBmYWxzZTtcbiAgcmV0dXJuICgpOiBUID0+IHtcbiAgICBpZiAoY2FsY3VsYXRlZCkge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgICB2YWx1ZSA9IGZuKCk7XG4gICAgY2FsY3VsYXRlZCA9IHRydWU7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9O1xufVxuIiwiaW1wb3J0IGFzc2VydCBmcm9tICdhc3NlcnQnO1xuXG5pbXBvcnQgeyBvbmNlIH0gZnJvbSAnLi4vdXRpbHMvb25jZSc7XG5cbmNvbnN0IGRldGVybWluZU1vbm9yZXBvUm9vdCA9IChjYW5kaWRhdGU6IHN0cmluZykgPT4ge1xuICAvLyB0cnkgdG8gZ3Vlc3Mgd2hhdCB0aGUgcm9vdCBpcyBjb25zaWRlcmluZyB0aGF0IG91ciBjb21tYW5kc1xuICAvLyBjYW4gYmUgZXhlY3V0ZWQgZnJvbSB3aXRoaW4gcGFja2FnZSBkaXJlY3Rvcnkgb3IgZnJvbSB0aGUgcm9vdFxuICBjb25zdCByZXN1bHQgPSAvKC4qKD89XFwvcGFja2FnZXNcXC8pKXwoLiooPz1cXC9ub2RlX21vZHVsZXNcXC8pKXwoLiopLy5leGVjKFxuICAgIGNhbmRpZGF0ZVxuICApO1xuICBhc3NlcnQoISFyZXN1bHQpO1xuICBjb25zdCBbLCBwYWNrYWdlc1Jvb3QsIG5vZGVNb2R1bGVzUm9vdCwgZW50aXJlUGF0aF0gPSByZXN1bHQ7XG4gIGNvbnN0IHJvb3RQYXRoID0gcGFja2FnZXNSb290IHx8IG5vZGVNb2R1bGVzUm9vdCB8fCBlbnRpcmVQYXRoO1xuICBhc3NlcnQoISFyb290UGF0aCk7XG4gIHJldHVybiByb290UGF0aDtcbn07XG5cbmV4cG9ydCBjb25zdCBndWVzc01vbm9yZXBvUm9vdCA9IG9uY2UoKCkgPT4ge1xuICByZXR1cm4gZGV0ZXJtaW5lTW9ub3JlcG9Sb290KHByb2Nlc3MuZW52WydJTklUX0NXRCddIHx8IHByb2Nlc3MuY3dkKCkpO1xufSk7XG4iLCIvKipcbiAqIENhcHR1cmUgdGhlIHN0YWNrIHRyYWNlIGFuZCBhbGxvdyB0byBlbnJpY2ggZXhjZXB0aW9ucyB0aHJvd24gaW4gYXN5bmNocm9ub3VzIGNhbGxiYWNrc1xuICogd2l0aCBhZGRpdGlvbmFsIHN0YWNrIGluZm9ybWF0aW9uIGNhcHR1cmVkIGF0IHRoZSBtb21lbnQgb2YgdGhlIGNhbGwgb2YgdGhpcyBmdW5jdGlvblxuICovXG5leHBvcnQgZnVuY3Rpb24gY2FwdHVyZVN0YWNrVHJhY2UocmVtb3ZlID0gMCkge1xuICBjb25zdCBzdGFja0NvbnRhaW5lciA9IHtcbiAgICBzdGFjazogJycsXG4gIH07XG4gIEVycm9yLmNhcHR1cmVTdGFja1RyYWNlKHN0YWNrQ29udGFpbmVyKTtcbiAgY29uc3Qgc3RhY2tUcmFjZSA9IHN0YWNrQ29udGFpbmVyLnN0YWNrXG4gICAgLnNwbGl0KCdcXG4nKVxuICAgIC5zbGljZSg2ICsgcmVtb3ZlKVxuICAgIC5qb2luKCdcXG4nKTtcbiAgcmV0dXJuIHtcbiAgICAvKipcbiAgICAgKiBDYXB0dXJlZCBzdGFjayB0cmFjZSBpbmZvcm1hdGlvblxuICAgICAqL1xuICAgIHN0YWNrVHJhY2UsXG4gICAgLyoqXG4gICAgICogQ2FuIGJlIGNhbGxlZCBpbiBhc3luY2hyb25vdXMgY2FsbGJhY2sgdG8gZW5yaWNoIGV4Y2VwdGlvbnMgd2l0aCBhZGRpdGlvbmFsIGluZm9ybWF0aW9uXG4gICAgICogQHBhcmFtIGVyciBFeGNlcHRpb24gdG8gZW5yaWNoIC0gaXQgaXMgZ29pbmcgdG8gaGF2ZSBpdHMgYC5zdGFja2AgcHJvcCBtdXRhdGVkXG4gICAgICogQHJldHVybnMgU2FtZSBleGNlcHRpb25cbiAgICAgKi9cbiAgICBwcmVwYXJlRm9yUmV0aHJvdzogKGVycjogRXJyb3IpID0+IHtcbiAgICAgIGNvbnN0IG9sZFN0YWNrVHJhY2UgPSBlcnIuc3RhY2sgPz8gJycuc3BsaXQoJ1xcbicpLnNsaWNlKDEpLmpvaW4oJ1xcbicpO1xuICAgICAgZXJyLnN0YWNrID0gYCR7ZXJyLm5hbWUgfHwgJ0Vycm9yJ306ICR7XG4gICAgICAgIGVyci5tZXNzYWdlXG4gICAgICB9XFxuJHtvbGRTdGFja1RyYWNlfVxcbiR7c3RhY2tUcmFjZX1gO1xuICAgICAgcmV0dXJuIGVycjtcbiAgICB9LFxuICB9O1xufVxuIiwiaW1wb3J0IHR5cGUge1xuICBDaGlsZFByb2Nlc3MsXG4gIENoaWxkUHJvY2Vzc1dpdGhvdXROdWxsU3RyZWFtcyxcbn0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5cbmltcG9ydCB7IGd1ZXNzTW9ub3JlcG9Sb290IH0gZnJvbSAnLi4vZmlsZS1zeXN0ZW0vZ3Vlc3NNb25vcmVwb1Jvb3QnO1xuaW1wb3J0IHsgY2FwdHVyZVN0YWNrVHJhY2UgfSBmcm9tICcuLi91dGlscy9zdGFja1RyYWNlJztcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNwYXduVG9Qcm9taXNlKFxuICBjaGlsZDogQ2hpbGRQcm9jZXNzIHwgQ2hpbGRQcm9jZXNzV2l0aG91dE51bGxTdHJlYW1zLFxuICBvcHRzPzoge1xuICAgIGV4aXRDb2Rlcz86IG51bWJlcltdIHwgJ2FueSc7XG4gICAgY3dkPzogc3RyaW5nO1xuICB9XG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgeyBwcmVwYXJlRm9yUmV0aHJvdyB9ID0gY2FwdHVyZVN0YWNrVHJhY2UoKTtcbiAgY29uc3QgZXhpdENvZGVzID0gb3B0cz8uZXhpdENvZGVzIHx8IFswXTtcblxuICBjb25zdCBjd2QgPSBndWVzc01vbm9yZXBvUm9vdCgpO1xuICBjb25zb2xlLmxvZyhcbiAgICBbJz4nLCBjaGlsZC5zcGF3bmZpbGUsIC4uLmNoaWxkLnNwYXduYXJncy5zbGljZSgxKV1cbiAgICAgIC5tYXAoKGVudHJ5KSA9PiBlbnRyeS5yZXBsYWNlKGN3ZCArICcvJywgJy4vJykpXG4gICAgICAuam9pbignICcpLFxuICAgIC4uLihvcHRzPy5jd2QgPyBbYGluICR7b3B0cy5jd2R9YF0gOiBbXSlcbiAgKTtcblxuICBhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocmVzLCByZWopID0+XG4gICAgY2hpbGRcbiAgICAgIC5vbignY2xvc2UnLCAoY29kZSwgc2lnbmFsKSA9PiB7XG4gICAgICAgIGlmICh0eXBlb2YgY29kZSA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICBpZiAoZXhpdENvZGVzICE9PSAnYW55JyAmJiAhZXhpdENvZGVzLmluY2x1ZGVzKGNvZGUpKSB7XG4gICAgICAgICAgICByZWooXG4gICAgICAgICAgICAgIHByZXBhcmVGb3JSZXRocm93KFxuICAgICAgICAgICAgICAgIG5ldyBFcnJvcihgUHJvY2VzcyBoYXMgZmFpbGVkIHdpdGggY29kZSAke2NvZGV9YClcbiAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmVzKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKHNpZ25hbCkge1xuICAgICAgICAgIHJlaihcbiAgICAgICAgICAgIHByZXBhcmVGb3JSZXRocm93KG5ldyBFcnJvcihgRmFpbGVkIHRvIGV4ZWN1dGUgcHJvY2VzczogJHtzaWduYWx9YCkpXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBwcmVwYXJlRm9yUmV0aHJvdyhuZXcgRXJyb3IoJ0V4cGVjdGVkIHNpZ25hbCBvciBlcnJvciBjb2RlJykpO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgLm9uKCdlcnJvcicsIHJlailcbiAgKTtcbiAgLy8gaW5oZXJpdCBleGl0IGNvZGVcbiAgaWYgKFxuICAgIHR5cGVvZiBjaGlsZC5leGl0Q29kZSA9PT0gJ251bWJlcicgJiZcbiAgICB0eXBlb2YgcHJvY2Vzcy5leGl0Q29kZSAhPT0gJ251bWJlcidcbiAgKSB7XG4gICAgcHJvY2Vzcy5leGl0Q29kZSA9IGNoaWxkLmV4aXRDb2RlO1xuICB9XG59XG4iLCJpbXBvcnQgeyBzcGF3biB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2Vzcyc7XG5cbmltcG9ydCB7IHNwYXduVG9Qcm9taXNlIH0gZnJvbSAnLi4vY2hpbGQtcHJvY2Vzcyc7XG5cbi8vIE5PVEU6IHBhdGggcmVsYXRpdmUgdG8gdGhlIC4vYmluIGF0IHRoZSByb290IG9mIHRoZSBwYWNrYWdlIHdoZXJlXG4vLyB0aGlzIGZpbGUgaXMgZ29pbmcgdG8gcmVzaWRlXG5jb25zdCBiaW5QYXRoID0gKGJpbjogc3RyaW5nKSA9PlxuICBuZXcgVVJMKGAuLi9ub2RlX21vZHVsZXMvLmJpbi8ke2Jpbn1gLCBpbXBvcnQubWV0YS51cmwpLnBhdGhuYW1lO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuQmluKGJpbjogc3RyaW5nLCBhcmdzID0gcHJvY2Vzcy5hcmd2LnNsaWNlKDIpKSB7XG4gIGF3YWl0IHNwYXduVG9Qcm9taXNlKFxuICAgIHNwYXduKGJpblBhdGgoYmluKSwgYXJncywge1xuICAgICAgc3RkaW86ICdpbmhlcml0JyxcbiAgICB9KSxcbiAgICB7XG4gICAgICBleGl0Q29kZXM6ICdhbnknLFxuICAgIH1cbiAgKTtcbn1cbiJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7OztBQUFPLFNBQUEsSUFBQSxDQUFpQixFQUFzQixFQUFBO0FBQzVDLEVBQUksSUFBQSxLQUFBLENBQUE7QUFDSixFQUFBLElBQUksVUFBYSxHQUFBLEtBQUEsQ0FBQTtBQUNqQixFQUFBLE9BQU8sTUFBUztBQUNkLElBQUEs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