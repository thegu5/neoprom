{
  pkgs ? import <nixpkgs> { },
}:
{
  prometheus-scrape = import ./test/integrated/prometheus-scrape.nix {
    inherit pkgs;
    inherit (pkgs) lib;
    src = ./.;
  };
}
