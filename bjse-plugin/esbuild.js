/**
 * esbuild script for bjse-plugin.
 *
 * React isolation strategy:
 *   VrmCastPanel runs inside ReactDOM.createRoot — its own React tree,
 *   completely isolated from BJSE's React tree.  Errors in our component
 *   never reach BJSE's componentDidCatch, so no white-screen reloads.
 *
 *   react + react-dom are BUNDLED (not external) so our React instance is
 *   self-contained.  Only fs-extra (node filesystem helper) and
 *   babylonjs-editor (host API) stay external.
 *
 * The banner is retained as a harmless no-op for now (it patches require.cache
 * slots that no longer exist as external requires, so it does nothing).
 */

const esbuild = require('esbuild');

// Banner kept for safety; no longer actively needed since react is bundled.
const banner = `(function(){})();`;

const config = {
  entryPoints: ['src/index.tsx'],
  bundle:      true,
  outfile:     'build/index.js',
  platform:    'node',
  format:      'cjs',
  // react + react-dom bundled → our VrmCastPanel uses its own React tree.
  // fs-extra and babylonjs-editor remain external (provided by BJSE / Node).
  external:    ['fs-extra', 'babylonjs-editor'],
  banner:      { js: banner },
};

async function main() {
  const isWatch = process.argv.includes('--watch');
  const ctx = await esbuild.context(config);

  if (isWatch) {
    await ctx.watch();
    console.log('[bjse-plugin] watching for changes…');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log('[bjse-plugin] build done → build/index.js');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
