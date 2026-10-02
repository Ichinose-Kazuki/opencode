{
  lib,
  stdenvNoCC,
  callPackage,
  bun,
  nodejs,
  sysctl,
  makeBinaryWrapper,
  models-dev,
  ripgrep,
  wayland,
  installShellFiles,
  versionCheckHook,
  writableTmpDirAsHomeHook,
  fetchurl,
  node_modules ? callPackage ./node_modules.nix { },
}:
let
  # The compiled binary resolves the Parcel watcher binding at runtime with
  # `require(<platform package>)`, but the Node modules this derivation builds
  # from do not include the platform package. Fetch the prebuilt binding and
  # ship it; the build script's watcher-binding shim honours
  # OPENCODE_PARCEL_WATCHER_PATH first.
  parcelWatcherBinding =
    if stdenvNoCC.hostPlatform.system == "x86_64-linux" then
      fetchurl {
        url = "https://registry.npmjs.org/@parcel/watcher-linux-x64-glibc/-/watcher-linux-x64-glibc-2.5.1.tgz";
        hash = "sha256-2dmtfQHjsXbm9gP5uSRROhYYTsiw3ih4L45lnBE9UKA=";
      }
    else
      null;
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "opencode";
  inherit (node_modules) version src;
  inherit node_modules;

  nativeBuildInputs = [
    bun
    nodejs # for patchShebangs node_modules
    installShellFiles
    makeBinaryWrapper
    models-dev
    writableTmpDirAsHomeHook
  ];

  postPatch = ''
    # NOTE: Relax Bun version check to be a warning instead of an error
    substituteInPlace packages/script/src/index.ts \
      --replace-fail 'throw new Error(`This script requires bun@''${expectedBunVersionRange}' \
                     'console.warn(`Warning: This script requires bun@''${expectedBunVersionRange}'
  '';

  configurePhase = ''
    runHook preConfigure

    cp -R ${finalAttrs.node_modules}/. .
    patchShebangs node_modules
    patchShebangs packages/*/node_modules

    runHook postConfigure
  '';

  env.MODELS_DEV_API_JSON = "${models-dev}/dist/_api.json";
  env.OPENCODE_DISABLE_MODELS_FETCH = true;
  env.OPENCODE_VERSION = finalAttrs.version;
  env.OPENCODE_CHANNEL = "prod";
  env.NODE_OPTIONS = "--max-old-space-size=4096";

  buildPhase = ''
    runHook preBuild

    cd ./packages/cli
    bun --bun ./script/build.ts --single --skip-install

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    install -Dm755 dist/cli-*/bin/opencode $out/bin/opencode

    # Ship the prebuilt platform Parcel binding and point the watcher-binding
    # shim at it; the packaged binary cannot resolve the package at runtime.
    WRAP_PARCEL_WATCHER=""
    ${lib.optionalString (parcelWatcherBinding != null) ''
      mkdir -p $out/lib/parcel-watcher
      tar -xzf ${parcelWatcherBinding} -C $out/lib/parcel-watcher --strip-components=1
      WRAP_PARCEL_WATCHER="--set OPENCODE_PARCEL_WATCHER_PATH $out/lib/parcel-watcher"
    ''}

    # OpenTUI dlopens Wayland for clipboard images.
    wrapProgram $out/bin/opencode \
      --prefix PATH : ${
        lib.makeBinPath (
          [
            ripgrep
          ]
          # bun runs sysctl to detect if running on rosetta2
          ++ lib.optional stdenvNoCC.hostPlatform.isDarwin sysctl
        )
      } ${lib.optionalString stdenvNoCC.hostPlatform.isLinux ''
        --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath [ wayland ]}
      ''} $WRAP_PARCEL_WATCHER

    ln -s opencode $out/bin/opencode2

    runHook postInstall
  '';

  postInstall = lib.optionalString (stdenvNoCC.buildPlatform.canExecute stdenvNoCC.hostPlatform) ''
    # v2 dropped the `completion` subcommand; --completions is the global flag.
    # --completions also accepts sh, which emits the same script as bash.
    # staged to files, substitute below rejects anything that is not a regular file
    $out/bin/opencode --completions bash > opencode.bash
    $out/bin/opencode --completions zsh > _opencode
    $out/bin/opencode --completions fish > opencode.fish

    installShellCompletion --cmd opencode \
      --bash opencode.bash \
      --fish opencode.fish \
      --zsh _opencode

    # OPENCODE_CLI_NAME is a build-time define, so the opencode2 copies are
    # renamed rather than regenerated. --replace-fail is a global literal
    # substitution, so any lowercase opencode that later appears in a
    # description or help text ships as opencode2 in the opencode2 copy.
    substitute opencode.bash opencode2.bash --replace-fail opencode opencode2
    substitute _opencode _opencode2 --replace-fail opencode opencode2
    substitute opencode.fish opencode2.fish --replace-fail opencode opencode2

    installShellCompletion --cmd opencode2 \
      --bash opencode2.bash \
      --fish opencode2.fish \
      --zsh _opencode2
  '';

  nativeInstallCheckInputs = [
    versionCheckHook
    writableTmpDirAsHomeHook
  ];
  doInstallCheck = true;
  versionCheckKeepEnvironment = [ "HOME" "OPENCODE_DISABLE_MODELS_FETCH" ];
  versionCheckProgramArg = "--version";

  passthru = {
    env = finalAttrs.env;
  };

  meta = {
    description = "The open source coding agent";
    homepage = "https://opencode.ai";
    license = lib.licenses.mit;
    mainProgram = "opencode";
    inherit (node_modules.meta) platforms;
  };
})
