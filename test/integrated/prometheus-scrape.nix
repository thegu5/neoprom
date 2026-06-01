{
  pkgs ? import <nixpkgs> { },
}:
pkgs.testers.runNixOSTest {
  name = "neoprom-prometheus-scrape";

  containers.app =
    { pkgs, ... }:
    {
      environment.systemPackages = [ pkgs.prometheus.cli ];
      systemd.services.metrics = {
        wantedBy = [ "multi-user.target" ];
        serviceConfig.ExecStart = "${pkgs.lib.getExe pkgs.nodejs-slim_latest} ${pkgs.lib.cleanSource ../../.}/test/integrated/metrics-server.ts";
      };

      services.prometheus = {
        enable = true;
        globalConfig.scrape_interval = "1s";
        scrapeConfigs = [
          {
            job_name = "neoprom";
            static_configs = [ { targets = [ "127.0.0.1:9000" ]; } ];
          }
        ];
      };
    };

  testScript = ''
    start_all()
    app.wait_for_unit("metrics.service")
    app.wait_for_unit("prometheus.service")
    app.wait_for_open_port(9000)
    app.wait_for_open_port(9090)

    app.wait_until_succeeds(
      "promtool query instant http://localhost:9090 collectors_ready | grep -q ' 1 '"
    )
  '';
}
