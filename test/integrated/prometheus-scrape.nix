{
  pkgs,
  lib,
  src,
}:
pkgs.testers.runNixOSTest {
  name = "neoprom-prometheus-scrape";

  interactive.sshBackdoor.enable = true;

  containers.app =
    { pkgs, ... }:
    {
      environment.systemPackages = [ pkgs.prometheus.cli ];
      systemd.services.metrics = {
        wantedBy = [ "multi-user.target" ];
        serviceConfig.ExecStart = "${lib.getExe pkgs.nodejs-slim_latest} ${src}/test/integrated/metrics-server.ts";
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
    import time

    start_all()
    app.wait_for_unit("metrics.service")
    app.wait_for_unit("prometheus.service")
    app.wait_for_open_port(9000)
    app.wait_for_open_port(9090)

    time.sleep(10)
    data = app.succeed("promtool query instant http://localhost:9090 neoprom_test_total")
    if " 1 " not in data:
      raise Exception(f"failure, invalid data: {data}")
    print(f"success: {data}")
  '';
}
