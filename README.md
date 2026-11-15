# netdiag

netdiag finds the cause of a network problem at each layer of the stack, and gives the next step.

**State: planned.** This repository has the plan and the site. It has no code yet. The plan is in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## What it does

A network problem can start at many layers, from the link and Wi-Fi up to HTTP and the path through the providers. The tool runs probes at these layers and collects typed facts. Then it calculates the probability of each cause, and tells you the next probe or the next step.

This sketch shows the planned output. The names and the addresses are examples.

```text
$ netdiag https://example.com
DNS   example.com -> 192.0.2.10      12 ms
TCP   192.0.2.10:443 connected       18 ms
TLS   handshake                     940 ms
HTTP  first byte                     35 ms

Probable causes
  0.81  A proxy examines the TLS traffic
  0.12  The server is slow
Next probe: the TLS handshake to 198.51.100.7, a second server on another network
```

## How it works

- **Probes are adapters.** Each probe tells if it is available, runs, and gives typed facts: the layer, the time, the source and the value.
- **The core needs no outside tool.** It does DNS lookups, TCP connects, the timing of the TLS handshake and the timing of each HTTP phase in TypeScript.
- **Outside tools are optional.** Adapters run `ping`, `traceroute`, `mtr`, `tshark` and `iperf3` when they are installed. The project bundles no tool with a restrictive license.
- **The diagnosis is a calculation.** A catalog of faults tells what each fault predicts at each layer. The facts give the probability of each cause.
- **The next probe gives the most information.** The tool picks the probe with the largest expected information gain over the top causes.
- **Labs give the ground truth.** Network labs inject each fault on purpose, and netdiag must name it. A gate in CI holds the hit rate of each fault class.

## Scope

netdiag runs active probes only against targets that you own or that you name. The core does no vulnerability scan.

## The site

The site is at [mark1russell7.github.io/netdiag](https://mark1russell7.github.io/netdiag/). Its Status page shows the items of the plan.

## License

[MIT](LICENSE)
