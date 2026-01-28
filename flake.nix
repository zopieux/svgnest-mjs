{
  description = "Modernized SVGnest library";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=203f2ddbe3a48ede1b20b3b86bc8664b311b512d";
    utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, utils }:
    utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        packages.svgnest = pkgs.mkYarnPackage {
          pname = "svgnest-mjs";
          version = "1.0.0";
          src = ./.;

          # yarnLock = ./yarn.lock;
          # packageJSON = ./package.json;

          buildPhase = ''
            export HOME=$TMPDIR
            cd deps/svgnest-mjs

            # Run build
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
            
            # Move package.json from dist to root
            mv $out/dist/package.json $out/package.json
            
            # Copy root files if relevant, though dist/ is the artifact.
            [ -f README.md ] && cp README.md $out/
            [ -f LICENSE.txt ] && cp LICENSE.txt $out/
          '';

          doDist = false;
        };

        packages.default = self.packages.${system}.svgnest;

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs
            yarn
          ];
        };
      }
    );
}