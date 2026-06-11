import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  // Mark undici as external so the dynamic `import('undici')` in client.ts
  // resolves at runtime (Node only). On non-Node runtimes the import simply
  // fails and the SDK falls back to the platform's native fetch.
  external: ['undici'],
});
