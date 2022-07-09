#!/usr/bin/env node
// NOTE: This file is bundled up from './src/bin/*' and needs to be committed
import { a as spawnToPromise, t as taskArgsPipe } from './taskArgsPipe.gen.mjs';
import 'node:assert';

const binPath = (bin) => new URL(`../node_modules/.bin/${bin}`, import.meta.url).pathname;
async function runBin(bin, args = taskArgsPipe([]), opts) {
  await spawnToPromise(binPath(bin), args, {
    ...opts,
    stdio: "inherit"
  });
}

export { runBin as r };
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicnVuQmluLmdlbi5tanMiLCJzb3VyY2VzIjpbIi4uL3NyYy9iaW4vcnVuQmluLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHtcbiAgU3Bhd25PcHRpb25zV2l0aEV4dHJhLFxuICBTcGF3blRvUHJvbWlzZU9wdHMsXG59IGZyb20gJy4uL2NoaWxkLXByb2Nlc3MnO1xuaW1wb3J0IHsgc3Bhd25Ub1Byb21pc2UgfSBmcm9tICcuLi9jaGlsZC1wcm9jZXNzJztcbmltcG9ydCB7IHRhc2tBcmdzUGlwZSB9IGZyb20gJy4uL3V0aWxzL3Rhc2tBcmdzUGlwZSc7XG5cbi8vIE5PVEU6IHBhdGggcmVsYXRpdmUgdG8gdGhlIC4vYmluIGF0IHRoZSByb290IG9mIHRoZSBwYWNrYWdlIHdoZXJlXG4vLyB0aGlzIGZpbGUgaXMgZ29pbmcgdG8gcmVzaWRlXG5jb25zdCBiaW5QYXRoID0gKGJpbjogc3RyaW5nKSA9PlxuICBuZXcgVVJMKGAuLi9ub2RlX21vZHVsZXMvLmJpbi8ke2Jpbn1gLCBpbXBvcnQubWV0YS51cmwpLnBhdGhuYW1lO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuQmluKFxuICBiaW46IHN0cmluZyxcbiAgYXJncyA9IHRhc2tBcmdzUGlwZShbXSksXG4gIG9wdHM/OiBTcGF3bk9wdGlvbnNXaXRoRXh0cmE8U3Bhd25Ub1Byb21pc2VPcHRzPlxuKSB7XG4gIGF3YWl0IHNwYXduVG9Qcm9taXNlKGJpblBhdGgoYmluKSwgYXJncywge1xuICAgIC4uLm9wdHMsXG4gICAgc3RkaW86ICdpbmhlcml0JyxcbiAgfSk7XG59XG4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFTQSxNQUFNLE9BQUEsR0FBVSxDQUFDLEdBQ2YsS0FBQSxJQUFJLElBQUksQ0FBd0IscUJBQUEsRUFBQSxHQUFBLENBQUEsQ0FBQSxFQUFPLE1BQVksQ0FBQSxJQUFBLENBQUEsR0FBRyxDQUFFLENBQUEsUUFBQSxDQUFBO0FBRTFELGVBQUEsTUFBQSxDQUNFLEtBQ0EsSUFBTyxHQUFBLFlBQUEsQ0FBYSxFQUFFLEdBQ3RCLElBQ0EsRUFBQTtBQUNBLEVBQUEsTUFBTSxjQUFlLENBQUEsT0FBQSxDQUFRLEdBQUcsQ0FBQSxFQUFHLElBQU0sRUFBQTtBQUFBLElBQ3ZDLEdBQUcsSUFBQTtBQUFBLElBQ0gsS0FBTyxFQUFBLFNBQUE7QUFBQSxHQUNSLENBQUEsQ0FBQTtBQUNIOzs7OyJ9
