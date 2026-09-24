declare const __WORK_OS_BUILD_ID__: string | undefined;

/**
 * Unique identity of the compiled Work OS bundle.
 * Vite replaces this constant at build time with the Git commit SHA (or an
 * explicit WORK_OS_BUILD_ID override). Keeping the client build identity inside
 * the compiled bundle lets an already-open tab compare itself with the currently
 * deployed server without relying on service-worker cache heuristics.
 */
export const APP_BUILD_ID =
  typeof __WORK_OS_BUILD_ID__ === 'string' && __WORK_OS_BUILD_ID__.trim()
    ? __WORK_OS_BUILD_ID__
    : 'development';
