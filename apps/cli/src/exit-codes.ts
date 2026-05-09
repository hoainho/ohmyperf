export const EXIT_CODES = {
  ok: 0,
  budgetFailure: 1,
  invalidUsage: 2,
  browserLaunchFailure: 3,
  navigationFailure: 4,
  measurementRuntimeError: 5,
  pluginLoadError: 6,
  oopifAttachOrderViolation: 7,
  pluginHookTimeout: 8,
  frozenLockfileDrift: 9,
  shareUploadRefused: 10,
  browserBinaryMissing: 11,
  calibrationFailed: 12,
} as const;

export type ExitCodeName = keyof typeof EXIT_CODES;
export type ExitCodeValue = (typeof EXIT_CODES)[ExitCodeName];
