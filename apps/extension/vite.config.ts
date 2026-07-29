import { defineConfig, type UserConfig } from 'vite';

function createScriptBuild(
  entry: string,
  fileName: string,
  format: 'es' | 'iife',
): UserConfig {
  return {
    build: {
      copyPublicDir: false,
      emptyOutDir: false,
      outDir: 'dist',
      rollupOptions: {
        input: entry,
        output: {
          codeSplitting: false,
          entryFileNames: fileName,
          format,
          ...(format === 'iife' ? { name: 'TaskTwinContentScript' } : {}),
        },
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  if (mode === 'service-worker') {
    return createScriptBuild(
      'src/service-worker.ts',
      'service-worker.js',
      'es',
    );
  }

  if (mode === 'content-script') {
    return createScriptBuild(
      'src/content-script.ts',
      'content-script.js',
      'iife',
    );
  }

  return {
    build: {
      outDir: 'dist',
    },
  };
});
