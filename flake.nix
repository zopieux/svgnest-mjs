{
  description = "Modernized SVGnest library";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=203f2ddbe3a48ede1b20b3b86bc8664b311b512d";
    utils.url = "github:numtide/flake-utils";
    svgnest-legacy = {
      url = "github:Jack000/SVGnest";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, utils, svgnest-legacy }:
    utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        jsclipper = pkgs.fetchzip {
          url = "https://downloads.sourceforge.net/project/jsclipper/Javascript_Clipper_6.4.2.2.zip";
          hash = "sha256-SSTDV+4vfYIsb20ZzSoM0xNps4zWTayl77rhWa4+qbY=";
          stripRoot = false;
        };
      in
      {
        packages.svgnest = pkgs.mkYarnPackage {
          pname = "svgnest-mjs";
          version = "1.0.0";
          src = ./.;

          buildPhase = ''
            export HOME=$TMPDIR
            cd deps/svgnest-mjs

            # Use legacy files from the remote input
            mkdir -p .orig
            cp -f ${svgnest-legacy}/*.js .orig/
            cp -rf ${svgnest-legacy}/util .orig/
            
            # Replace clipper with the one from jsclipper
            # The zip content structure is usually Javascript_Clipper_6.4.2.2/...
            find ${jsclipper} -name "clipper.js" -exec cp -f {} .orig/util/clipper.js \;

            chmod -R +w .orig

            # Run transformation and build
            yarn --offline transform
            node tools/build.js
          '';

          doCheck = true;
          checkPhase = ''
            export HOME=$TMPDIR
            ./node_modules/.bin/vitest run --cache=false
          '';

          installPhase = ''
            mkdir -p $out
            cp -r dist $out/
            cp index.d.ts $out/dist/
            [ -f README.md ] && cp README.md $out/
            [ -f LICENSE.txt ] && cp LICENSE.txt $out/

            # Produce a clean package.json for users
            node -e "
              const fs = require('fs');
              const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

              delete pkg.devDependencies;
              delete pkg.scripts;

              pkg.main = 'dist/svgnest.cjs';
              pkg.module = 'dist/svgnest.mjs';
              pkg.types = 'dist/index.d.ts';
              pkg.exports = {
                '.': {
                  'types': './dist/index.d.ts',
                  'import': './dist/svgnest.mjs',
                  'require': './dist/svgnest.cjs'
                },
                './nestWorker': './dist/nestWorker.js'
              };

              fs.writeFileSync('$out/package.json', JSON.stringify(pkg, null, 2));
            "
          '';

          doDist = false;
        };

        packages.default = self.packages.${system}.svgnest;

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs
            yarn
            (pkgs.writeShellScriptBin "update-svgnest-source" ''
              chmod -R ug+w .orig || true
              rm -rf .orig
              mkdir -p .orig
              cp -f ${svgnest-legacy}/*.js .orig/
              cp -rf ${svgnest-legacy}/util .orig/
              chmod -R u+w .orig
              find ${jsclipper} -name "clipper.js" -exec cp -f {} .orig/util/clipper.js \;
              chmod -R -w .orig
            '')
          ];
        };
      }
    );
}
