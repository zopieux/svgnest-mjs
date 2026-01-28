import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

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
      return { path: "./worker.js?worker", external: true }; 
    });
  },
};

// Plugin to stub web-worker for browser builds
const webWorkerStubPlugin = {
  name: 'web-worker-stub',
  setup(build) {
    build.onResolve({ filter: /^web-worker$/ }, () => {
      return { path: 'data:application/javascript,export default function(){};', namespace: 'web-worker-stub' };
    });
    build.onLoad({ filter: /.*/, namespace: 'web-worker-stub' }, (args) => {
        return { contents: args.path.slice('data:application/javascript,'.length), loader: 'js' };
    });
  },
};

async function build() {
  // Build ESM version
  await esbuild.build({
    entryPoints: [path.join(rootDir, "src/index.ts")],
    bundle: true,
    format: "esm",
    outfile: path.join(distDir, "svgnest.mjs"),
    platform: "browser",
    sourcemap: true,
    external: ["url", "path"], // removed web-worker from external
    plugins: [workerPlugin, webWorkerStubPlugin],
  });

  // Build CJS version
  await esbuild.build({
    entryPoints: [path.join(rootDir, "src/index.ts")],
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
    entryPoints: [path.join(rootDir, "src/util/worker.ts")],
    bundle: true,
    format: "iife",
    outfile: path.join(distDir, "worker.js"),
    platform: "browser",
    target: "esnext",
  });

  // Create dist/package.json (intended to be moved to root)
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
  const distPkg = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    type: "module",
    main: "dist/svgnest.cjs",
    module: "dist/svgnest.mjs",
    types: "dist/index.d.ts",
    exports: {
      ".": {
        "import": "./dist/svgnest.mjs",
        "require": "./dist/svgnest.cjs",
        "types": "./dist/index.d.ts"
      },
      "./worker": "./dist/worker.js"
    },
    dependencies: pkg.dependencies,
    repository: pkg.repository,
    license: pkg.license
  };
  
  fs.writeFileSync(path.join(distDir, "package.json"), JSON.stringify(distPkg, null, 2));
  
  // Generate type definitions
  try {
      console.log("Generating type definitions...");
      execSync("npx tsc --emitDeclarationOnly --declaration", { cwd: rootDir });
  } catch (err) {
      console.error("Type generation failed:", err.stdout ? err.stdout.toString() : err.message);
  }

  console.log("Build complete! Files are in dist/");
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
