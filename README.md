# netdiag

netdiag finds the cause of a network problem at each layer of the stack, and gives the next step.

**State: early.** The package [`@mark1russell7/netdiag`](packages/netdiag) has the model of facts, the contract of a probe and the scope rule (ND-1). It also has the catalog of faults and the probability model (ND-4), and the native probes for DNS, TCP, TLS and HTTP (ND-2). The package [`@mark1russell7/netdiag-cli`](packages/netdiag-cli) has the program `netdiag` (ND-8). The plan is in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## What it does

A network problem can start at many layers, from the link and Wi-Fi up to HTTP and the path through the providers. The tool runs probes at these layers and collects typed facts. Then it calculates the probability of each cause, and tells you the next probe or the next step.

In this example, no program listens on port 443 of the target. The names are examples. The [README of the command line](packages/netdiag-cli/README.md) tells each option.

```text
$ netdiag check shop.example.com --reference example.org
netdiag check shop.example.com (https, path /)

The probable causes
   89%  No program listens on the port.
        To do: Start the service, or use the correct port.
    2%  A device on the path resets the connections.
        To do: Examine the firewalls and the filters of content on the path, and try a different network.
    1%  A filter drops the packets to the port.
        To do: Examine the firewall rules of the host and of each network on the path.

The next step (it can give 0.01 bits of information about the causes)
  Run the check again with --ping-count 20.

12 observations from 8 facts. The option --json gives each fact.
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

The site is at [metrograph-labs.github.io/netdiag](https://metrograph-labs.github.io/netdiag/). Its Status page shows the items of the plan.

## License

[MIT](LICENSE)
