{ pkgs, lib, config, inputs, ... }:

{
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_22;
    pnpm.enable = true;
  };

  enterShell = ''
    echo "ismynbncooked dev shell loaded"
  '';
}
