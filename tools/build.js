import esbuild from "esbuild";
import fs from "fs";
import path from "path";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const rootDir = path.join(__dirname, "..");
const distDir = path.join(rootDir, "dist");

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir);
}

// Plugin to handle ?worker imports
const workerPlugin = {
  name: 'worker-plugin',
  setup(build) {
    build.onResolve({ filter: /\?worker$/ }, args => {
      // Rewrite the path to be flat relative to the bundle
      return { path: "./nestWorker.js?worker", external: true }; 
    });
  },
};

async function build() {
  // Build ESM version
  await esbuild.build({
    entryPoints: [path.join(rootDir, "src/index.js")],
    bundle: true,
    format: "esm",
    outfile: path.join(distDir, "svgnest.mjs"),
    platform: "browser",
    sourcemap: true,
    external: ["url", "path", "web-worker"],
    plugins: [workerPlugin],
  });

  // Build CJS version
  await esbuild.build({
    entryPoints: [path.join(rootDir, "src/index.js")],
    bundle: true,
    format: "cjs",
    outfile: path.join(distDir, "svgnest.cjs"),
    platform: "browser",
    sourcemap: true,
    external: ["url", "path", "web-worker"],
    plugins: [workerPlugin],
  });

  // Build standalone Worker
  await esbuild.build({
    entryPoints: [path.join(rootDir, "src/util/nestWorker.js")],
    bundle: true,
    format: "iife",
    outfile: path.join(distDir, "nestWorker.js"),
    platform: "browser",
    target: "esnext",
  });

  // Create dist/package.json
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
  const distPkg = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    type: "module",
    main: "./svgnest.cjs",
    module: "./svgnest.mjs",
    types: "./index.d.ts",
    exports: {
      ".": {
        "import": "./svgnest.mjs",
        "require": "./svgnest.cjs",
        "types": "./index.d.ts"
      },
      "./nestWorker": "./nestWorker.js"
    },
    dependencies: pkg.dependencies,
    repository: pkg.repository,
    license: pkg.license
  };
  
  fs.writeFileSync(path.join(distDir, "package.json"), JSON.stringify(distPkg, null, 2));
  
  // Copy type definitions
  if (fs.existsSync(path.join(rootDir, "index.d.ts"))) {
      fs.copyFileSync(path.join(rootDir, "index.d.ts"), path.join(distDir, "index.d.ts"));
  }

  console.log("Build complete! Files are in dist/");
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
