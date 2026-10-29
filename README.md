# @gu5/neoprom

neoprom is a modern TypeScript-first client library for [Prometheus](https://prometheus.io/), inspired by [prom-client](https://github.com/siimon/prom-client/).

(heavy work-in-progress!)

## Comparison

|                          | prom-client | @gu5/neoprom |
| ------------------------ | :---------: | :----------: |
| Fully tested             |     ✅      |      ❌      |
| TypeScript-first[^1]     |     ❌      |      ✅      |
| Decorators/Wrappers[^2]  |     ❌      |      ✅      |
| Standard runtime metrics |     ✅      |      ⏳      |
| Worker/Cluster Support   |     ✅      |      ❌      |
| Push Gateway             |     ✅      |      ✅      |
| Exemplars                |     ✅      |      ❌      |
| **Metric Types**         |
| Counter                  |     ✅      |      ✅      |
| Gauge                    |     ✅      |      ✅      |
| Histogram                |     ✅      |      ✅      |
| Summary                  |     ✅      |      ✅      |
| Info                     |     ❌      |      ✅      |
| StateSet                 |     ❌      |      ✅      |
| GaugeHistogram           |     ❌      |      ❌      |

[^1]: The entire library is written in TypeScript. Effort has been put in to make the types as accurate and strict as possible.
[^2]: This refers to the `time` and `trackInProgress` methods. They can be used both to wrap functions, as well as ES7 class method decorators. See their docs for more.

<!--## Histograms vs Summaries

Histograms and Summaries appear similar at first glance, but have very different use cases.

Histograms must have buckets defined up-front, so you must have a general idea of what
the values you're going to track look like (0.0001? 0.1?). Once ingested in a Prometheus server, they are then very flexible to work with.

On the other hand, Summaries can calculate your buckets for you based on percentiles. A reasonable set of percentiles is provided as the `PERCENTILES` export. Summaries can also track values for the lifetime of the process (default behavior), or over a sliding time window. See its option documentation for more details.

Further reading: https://prometheus.io/docs/practices/histograms/

## Summary quantiles

Configure `percentiles` to expose quantiles (the default is `[]`, exposing only
`_sum` and `_count`). Quantiles cover all observations since the series was created
or reset by default; elapsed time does not expire them. Observations are compressed
in a t-digest rather than stored individually.

To enable sliding-window quantiles, supply **both** `maxAgeSeconds` and `ageBuckets`,
for example `{ percentiles: [0.5, 0.99], maxAgeSeconds: 600, ageBuckets: 5 }`.
Supplying only one age option leaves quantiles lifetime-based, matching `client_js`.
The sum and count remain cumulative unless the series is reset or pruned.-->

## Todos / Ideas

- Docs
  - Add TSDoc comments for everything
  - Standalone documentation site with more details (?)
- Integration testing [with NixOS](https://nix.dev/tutorials/nixos/integration-testing-using-virtual-machines.html)
- Metric aggregation
  - sum, average etc like how prom-client does it
  - 'preserve' format that outputs multiple observations per metric (OpenMetrics-only)
- See comparison chart above
- Compare naming and data model to [prometheus docs](https://prometheus.io/docs/instrumenting/writing_clientlibs/), consider aliases, etc
- ...
