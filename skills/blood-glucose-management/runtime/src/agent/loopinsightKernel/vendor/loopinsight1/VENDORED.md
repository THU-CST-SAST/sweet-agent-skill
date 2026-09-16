# Vendored LoopInsighT1 Kernel

Source repository: `../loopinsight1`

Source revision: `3866af04df244da73b072f4921684f5fd8a3bf38`

The portable `src/common`, `src/core`, and `src/types` modules are included.
Node entrypoints, the HTTP server, examples, tests, and frontend files are
excluded. Relative `.js` import suffixes were removed for React Native module
resolution, TypeScript checking is disabled on mechanically vendored files,
and trailing whitespace was normalized. The simulation algorithms are
otherwise unchanged.
