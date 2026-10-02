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
  node_modules ? callPackage ./node-modules.nix { },
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

  # Shell completion generation is disabled: v2 removed the "completion"
  # subcommand, so `opencode completion` is parsed as the optional directory
  # argument and the command aborts (ENOENT chdir "completion"), which made
  # installShellCompletion fail on an empty file. The sandbox does not use
  # these completions.

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
