# Roadmap

This file is the plan of netdiag. The Status page of the site reads it.

netdiag finds the cause of a network problem at each layer of the stack, and gives the next step. The layers are the link, Wi-Fi, IP, the routes, DNS, TCP, TLS, HTTP and the path through the providers.

## The design

1. **Probes are adapters.** Each probe tells if it is available, runs, and parses its output into typed facts. A fact has a layer, a time, a source and a value.
2. **The core needs no outside tool.** It does DNS lookups, TCP connects, the timing of the TLS handshake and the timing of each HTTP phase in TypeScript.
3. **Outside tools are optional adapters.** Examples are `ping`, `traceroute`, `mtr`, `tshark` and `iperf3`. Each command starts with an argument list and no shell, through `@procedures/shell`.
4. **The diagnosis is a calculation.** A model of the parts and a catalog of faults give the probability of each cause from the facts.
5. **The next probe gives the most information.** The tool picks the probe with the largest expected information gain over the top causes.
6. **A lab gives the ground truth.** The labs inject each fault class on purpose, and netdiag must name it. A gate in CI holds the hit rate of each fault class.
7. **The scope rule.** Active probes run only against targets that the user owns or names. The core does no vulnerability scan.

### The parts and the faults

The model has these parts: the network interface, the Wi-Fi link, the gateway, the DNS resolver, the hops of each provider and the remote service. Each fault of the catalog is data. It tells what the fault predicts at each layer.

The rules of practice are the first likelihoods of the model. They are not fixed thresholds. The results of the labs then correct them.

| Facts | Most probable cause |
| --- | --- |
| The DNS lookup fails. | The chain stops at DNS. TCP, TLS and HTTP cannot start. |
| `ping` fails, and a TCP connect succeeds. | A filter blocks ICMP. The host is up. |
| The TCP connect gets "connection refused". | No program listens on the port. |
| The TCP connect times out. | A filter drops the packets. |
| The TLS handshake is slow, and the TCP connect is fast. | A proxy examines the TLS traffic. |
| The time to the first byte is slow, and the handshakes are fast. | The server is slow. |

### The metrics

- Jitter: the standard deviation of the round-trip times, and the estimator of RFC 3550, `J += (abs(D) - J) / 16`. `D` is the change of the transit time between two packets.
- Delay variation: the IP packet delay variation of RFC 3393.
- Loss: the one-way packet loss of RFC 7680.
- Retransmission timeout: the RTO of RFC 6298, with the smoothed RTT of Jacobson. By the rule of Karn, a retransmitted packet gives no sample.
- Bandwidth: packet pairs. The packet size, divided by the gap between the two packets at the receiver.
- MTU: the largest payload that passes with "do not fragment" set, plus 28 bytes for IPv4 and 48 bytes for IPv6. Each is the IP header (20 or 40) and the ICMP header (8).

The statistics come from `@mark1russell7/rigor-statistics`. The timers and the backoff come from `@mark1russell7/algebra`. The loops come from `@mark1russell7/service`.

### The ground truth

The network labs of [mark1russell7/systems](https://github.com/mark1russell7/systems) inject each fault class on purpose:

- `@mark1russell7/harness`: Docker topologies, Toxiproxy, and `iptables` and `tc netem` in a sidecar with `NET_ADMIN`.
- `@mark1russell7/kind`: kind clusters with faults.
- Later: containerlab, virtual machines and k3s.

The score is the hit rate of each fault class, from a confusion matrix. A gate in CI holds each rate. The lab runs need Docker, so only CI starts them.

ND-7 has four steps:

1. **The score.** A lab record has the true hypothesis and the diagnosis. `scoreLab` gives the confusion table, the recall of each hypothesis with its Wilson interval, and the Brier score. `labGate` holds the lower end of each recall. The table and the intervals come from `@mark1russell7/rigor-statistics`.
2. **The loopback lab.** The package `@netdiag/lab` starts real servers on lab addresses of `lo`: a resolver, the target, a reference host and a captive portal. `@mark1russell7/rigor-proxy` holds the first reply of a TLS proxy. Its 13 cases make the 11 classes of the loopback row. The workflow `lab.yml` runs 5 rounds in CI, because the times are part of the evidence. A case that does not show the signs of its fault gives no read.
3. **The kernel lab.** The command `packages/lab/src/kernel/main.ts` makes faults with real kernels in Docker, through `@mark1russell7/harness`. Each round has one world: a client, the router `gw`, the target, a reference host and a resolver. The agent in the client starts `visitTarget` of netdiag and writes one JSON line for each fact. The first slice has the cases `none`, `filter.drop`, `filter.icmp`, `path.loss` and `path.mtu`. The second slice adds `host.down`, `filter.reset` and `gateway.down`, with the faults of harness 0.16.2 and the passive probe `link.state`. The gate lists `ipv6.broken` with no bar, until the harness has IPv6. The workflow `lab-kernel.yml` starts 5 rounds in CI.
4. **The bars.** The bar of each class is the worst of 5 or more CI runs, minus their spread. `labBars` of netdiag gives them: the least lower end of the recall interval, minus 2 standard deviations of the lower ends (`noiseFloor` of `rigor-statistics`). A dispatch of a lab workflow with the inputs `runs` and `bars` starts the runs in a matrix, and its job `bars` computes the bars. Each lab job passes its file of `packages/lab/bars/` with `--bars`, and the lab checks are necessary for a merge.

| Lab | Fault classes |
| --- | --- |
| Loopback | `none`, `resolver.down`, `resolver.failing`, `name.missing`, `port.closed`, `tls.cert-invalid`, `tls.mismatch`, `tls.proxy`, `server.slow`, `server.error`, `captive.portal` |
| Kernel | `none`, `filter.drop`, `filter.icmp`, `path.loss`, `path.mtu`, `host.down`, `filter.reset`, `gateway.down` |
| Kernel, later | `ipv6.broken`. The networks of the harness have no IPv6 yet. The gate lists it with no bar. |
| None yet | `interface.down`, `wifi.weak`. The gate lists them with no bar. |

### The licenses of the outside tools

The table of licenses is data: `TOOL_LICENSES` in the entry `@mark1russell7/netdiag/tools` (ND-3). The project bundles no tool with a restrictive license.

| Tool | License | In netdiag |
| --- | --- | --- |
| `ping` | The license of the operating system | Optional adapter |
| `traceroute` | GPL on Linux | Optional adapter |
| `mtr` | GPL | Optional adapter |
| `tshark` | GPL | Optional adapter |
| `iperf3` | BSD | Optional adapter |
| `iw` | ISC | Optional adapter |
| `netsh` | The license of the operating system | Optional adapter |
| `system_profiler` | The license of the operating system | Optional adapter |
| `nmap` | NPSL | Not bundled |
| `masscan` | AGPL | Not bundled |
| Speedtest CLI | Ookla EULA | Not bundled |

### The command-line tool

The package `@mark1russell7/netdiag-cli` has the program `netdiag` (ND-8). The core package has no dependency of the command line. The command `netdiag check <target>` has these steps:

1. `planCheck` reads the options and makes the grants of the scope.
2. `visitTarget` reads the link and the Wi-Fi link of this computer. Then it probes the target, each reference host and the gateway. The outside tools start through `runCommand` of `@procedures/shell`.
3. `readEvidence` and `diagnose` give the probability of each cause. A fact of the target gives primary evidence.
4. `rankProbes` gives the next step. Each candidate is one probe of one role, with the features that the evidence does not have.

The scope grants only the target, each reference host, the DNS resolver, the gateway and each range of `--grant`. The visit adds each address that the resolver gives for a granted name. The [README of the package](../packages/netdiag-cli/README.md) tells the options and the output.

## Items

The first path is ND-1, then ND-2 and ND-4, then ND-7. Priority P0 comes first. The size is S, M or L.

The status words are `active`, `waiting`, `blocked`, `later`, `done` and `dropped`. A `later` item with each need done is ready.

| ID | Item | Status | Priority | Size | Area | Needs | Summary |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ND-1 | The fact and probe model | done | P0 | M | core | - | The types of a fact: the layer, the time, the source and the value. The contract of a probe: available, run and parse. Each probe tells if it is active. The core starts an active probe only against a target that the user owns or names. |
| ND-2 | Native probes: DNS, TCP, TLS and HTTP | done | P0 | L | probes | ND-1 | DNS lookups, TCP connects, the time of the TLS handshake and the time of each HTTP phase, in TypeScript on the `node:` modules. They need no outside tool. Tests run each probe against local servers. |
| ND-3 | Adapters of outside tools, with the license table as data | done | P1 | M | probes | ND-1 | Optional adapters for `ping`, `traceroute`, `mtr`, `tshark` and `iperf3`, in the entry `@mark1russell7/netdiag/tools`. A host parameter starts each command with an argument list and no shell. The function `commandHost` makes a host from `runCommand` of `@procedures/shell`, and the CLI (ND-8) gives it. The license of each tool is a row of data. The `ping` adapter and its readers are the first step. The second step is the adapters of `traceroute` (`tracert` on Windows) and `mtr`, with the fact kinds `path.trace` and `path.report`. The third step is the adapters of `iperf3` and `tshark`, with the fact kinds `path.throughput` and `path.capture`. |
| ND-4 | The fault catalog and the probability model | done | P0 | L | diagnosis | ND-1 | A model of the parts and a catalog of faults as data. Each fault tells what it predicts at each layer. The readers change the facts of the probes into evidence. The model gives the probability of each cause. The rules of practice are the first likelihoods. |
| ND-5 | The choice of the next probe | done | P1 | M | diagnosis | ND-4 | The tool picks the probe with the largest expected information gain over the top causes. `rankProbes` and `featuresOf` shipped in 0.1.2. The command-line tool (ND-8) shows the next step. |
| ND-6 | The metric estimators | done | P2 | M | metrics | ND-1, ND-3 | Jitter, delay variation, loss, the retransmission timeout, packet-pair bandwidth and the MTU, as "The metrics" tells. The statistics come from `@mark1russell7/rigor-statistics`. Step 1: the estimators from the facts `icmp.echo` and `path.capture`. Step 2: the probe `path.mtu`, a search with "do not fragment" over `ping`, and the feature `path.mtu`. Step 3: the visit searches the MTU after a TLS or HTTP time-out, and `netdiag check` gets `--mtu` and a next step for it. Step 4: the kernel case `path.mtu` uses the search. Since harness 0.16.3, the `mtu` fault of the harness drops each protocol, not only TCP. |
| ND-7 | Lab ground truth and the accuracy gate | done | P0 | L | ground truth | ND-2, ND-4 | The labs of `mark1russell7/systems` inject each fault class, and netdiag must name it. A confusion matrix gives the hit rate of each class, and a gate in CI holds each rate. The runs need Docker, so only CI starts them. |
| ND-8 | The command-line tool | done | P1 | M | cli | ND-2, ND-5 | The program `netdiag` is in the package `@mark1russell7/netdiag-cli` 0.1.0. The command `netdiag check <target>` gives the probable causes, their probabilities and the next step. The arguments and the help come from `@procedures/cli-kit`. The probes come from `visitTarget` of netdiag (ND-7, step 3), and the next step from `rankProbes` (ND-5). |
| ND-9 | Views on the site | active | P2 | M | site | ND-8 | A flow of the probes, one ring for each layer and a timeline of the facts. The views read the records of the command-line tool. Slice 1: `readFact`, `readCheckReport`, the sample reports of the lab, and demo 4 of the site. |
| ND-10 | Wi-Fi facts for each operating system | active | P2 | M | probes | ND-1, ND-3 | The signal, the noise, the channel, the rate and the roams of the Wi-Fi link, as typed facts. Each operating system has its own adapter. Step 1: the adapters of `iw`, `system_profiler` and `netsh`, the reader of `wifi.signal` and `wifiChanges`. Step 2: the visit and `netdiag check` read the Wi-Fi link. The kernel lab has no Wi-Fi, so its agent does not read it. |
| ND-11 | The path through the providers | later | P2 | M | probes | ND-3 | The AS number of each hop of a route. Thus a fault gets the name of the provider network where it starts. The lookups in the public registries go through `polite-crawler`. |
| ND-12 | Each probe of a visit as one candidate | done | P1 | S | diagnosis | ND-5 | `rankProbes` takes the 7 features of an HTTPS request (0.1.6). The limit of joint values is 65536. A test holds each probe of the package under it. |
| ND-13 | One HTTPS candidate in `netdiag check` | done | P2 | S | cli | ND-8, ND-12 | The next step of an `https` check takes the HTTPS request as one candidate with its 7 features, as the site demo does. The TLS handshake stays a cheaper candidate (netdiag-cli 0.3.0). |
