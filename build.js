import * as esbuild from 'esbuild';

async function runBuild() {
  console.log('Building TypeScript project...');

  await esbuild.build({
    entryPoints: ['src/server/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: 'dist/TchaT-server.js',
    external: ['ws', 'sqlite3', '@libsql/sqlite3'],
  });

  await esbuild.build({
    entryPoints: ['src/client/index.ts'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    minify: true,
    outfile: 'dist/TchaT-client.js',
  });

  console.log('Build complete! Check the /dist folder.');
}

runBuild().catch(() => process.exit(1));