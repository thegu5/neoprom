{
  pkgs ? import <nixpkgs> { },
}:
let
  lib = pkgs.lib;
in
{
  prometheus-scrape = import ./test/integrated/prometheus-scrape.nix {
    inherit pkgs lib;
    src = lib.cleanSource ./.;
  };
}
