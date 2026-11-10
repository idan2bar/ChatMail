import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('src/static', 'dist', { recursive: true });
// The SDK's background script injects this file by its root-relative name.
cpSync('node_modules/@inboxsdk/core/pageWorld.js', 'dist/pageWorld.js');

const ctx = await esbuild.context({
  entryPoints: { content: 'src/content.js', background: 'src/background.js' },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  logLevel: 'info',
});

if (watch) await ctx.watch();
else { await ctx.rebuild(); await ctx.dispose(); }
