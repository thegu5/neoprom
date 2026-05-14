# @gu5/neoprom
neoprom is a modern TypeScript-first client library for [Prometheus](https://prometheus.io/), inspired by [prom-client](https://github.com/siimon/prom-client/).

(heavy work-in-progress!)

## Comparison
|                          | prom-client | @gu5/neoprom |
| ------------------------ | :---------: | :----------: |
| Fully tested             |      ✅      |      ❌       |
| TypeScript-first[^1]     |      ❌      |      ✅       |
| Decorators/Wrappers[^2]  |      ❌      |      ✅       |
| Standard runtime metrics |      ✅      |      ⏳       |
| Worker/Cluster Support   |      ✅      |      ❌       |
| Push Gateway             |      ✅      |      ❌       |
| Exemplars                |      ✅      |      ❌       |
| **Metric Types**         |
| Counter                  |      ✅      |      ✅       |
| Gauge                    |      ✅      |      ✅       |
| Histogram                |      ✅      |      ✅       |
| Summary                  |      ✅      |      ❌       |
| Info                     |      ❌      |      ✅       |
| StateSet                 |      ❌      |      ✅       |
| GaugeHistogram           |      ❌      |      ❌       |

[^1]: The entire library is written in TypeScript. Effort has been put in to make the types as accurate and strict as possible.
[^2]: This refers to the `time` and `trackInProgress` methods. They can be used both to wrap functions, as well as ES7 class method decorators. See their docs for more.
