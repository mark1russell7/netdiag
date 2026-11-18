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
2. **The loopback lab.** The package `@netdiag/lab` starts real servers on lab addresses of `lo`: a resolver, the target, a reference host and a captive portal. `@mark1russell7/rigor-proxy` holds the first reply of a TLS proxy. Its 13 cases make the 10 fault classes of the loopback column and the control `none`. The workflow `lab.yml` runs 5 rounds in CI, because the times are part of the evidence. A case that does not show the signs of its fault gives no read.
3. **The kernel lab.** The command `packages/lab/src/kernel/main.ts` makes faults with real kernels in Docker, through `@mark1russell7/harness`. Each round has one world: a client, the router `gw`, the target, a reference host and a resolver. The agent in the client starts `visitTarget` of netdiag and writes one JSON line for each fact. The first slice has the cases `none`, `filter.drop`, `filter.icmp`, `path.loss` and `path.mtu`. The second slice adds `host.down`, `filter.reset` and `gateway.down`, with the faults of harness 0.16.2 and the passive probe `link.state`. The gate lists `ipv6.broken` with no bar, until the harness has IPv6. The workflow `lab-kernel.yml` starts 5 rounds in CI.
4. **The bars.** The bar of each class is the worst of 5 or more CI runs, minus their spread. `labBars` of netdiag gives them: the least lower end of the recall interval, minus 2 standard deviations of the lower ends (`noiseFloor` of `rigor-statistics`). A dispatch of a lab workflow with the inputs `runs` and `bars` starts the runs in a matrix, and its job `bars` computes the bars. Each lab job passes its file of `packages/lab/bars/` with `--bars`, and the lab checks are necessary for a merge.

### The coverage of the fault classes

The ladder of the coverage comes from the data of the labs. `coverage` of `@netdiag/lab` gives a cell for each fault class on each layer E0 to E6 of the lab (ND-17).

- Each fault class must have a test on each layer. The work ends only at zero gaps.
- A covered cell names its cases. A cell with a case and no bar is a gap. A proposed class of the fault grammar is a gap in each cell that is not impossible.
- A cell is impossible only when its class needs a trait that its layer cannot have. Each limit comes from the column "What it cannot prove" of S7.
- The file `packages/lab/bars/coverage.json` keeps the counts. A unit test fails when the counts change, so a rise of the gaps stops CI.
- The command `pnpm --filter @netdiag/lab roadmap` writes this part and the data of the site. A unit test fails when a file is not current.

<!-- coverage:start. The command `pnpm --filter @netdiag/lab roadmap` writes this part. Do not edit it. -->

- **613 gaps** in 651 cells: 93 classes on 7 layers. The classes of the catalog have 103 gaps, and the proposed classes have 510 gaps. 37 cells covered, and 1 cell impossible. The work ends only at zero gaps.

| Class | Layer | E0 | E1 | E2 | E3 | E4 | E5 | E6 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `interface.down` | `link` | ✓ 80 cases of `sim` | ○ | ○ | ○ | ○ | ○ | ○ |
| `wifi.weak` | `wifi` | ✓ 80 cases of `sim` | ○ | ○ | ○ | ○ | ○ | ○ |
| `host.down` | `ip` | ✓ 80 cases of `sim` | ✓ `host.down` | ○ | ○ | ○ | ○ | ○ |
| `filter.icmp` | `ip` | ✓ 80 cases of `sim` | ✓ `filter.icmp` | ○ | ○ | ○ | ○ | ○ |
| `ipv6.broken` | `ip` | ✓ 80 cases of `sim` | ○ | ○ | ○ | ○ | ○ | ○ |
| `gateway.down` | `route` | ✓ 80 cases of `sim` | ✓ `gateway.down` | ○ | ○ | ○ | ○ | ○ |
| `path.loss` | `path` | ✓ 80 cases of `sim` | ✓ `path.loss`, `loss.last-link`, `loss.first-link` | ○ | ○ | ○ | ○ | ○ |
| `path.mtu` | `path` | ✓ 80 cases of `sim` | ✓ `path.mtu` | ○ | ○ | ○ | ○ | ○ |
| `resolver.down` | `dns` | ✓ 80 cases of `sim` | ✓ `resolver.down/silent`, `resolver.down/absent` | ○ | ○ | ○ | ○ | ○ |
| `resolver.failing` | `dns` | ✓ 80 cases of `sim` | ✓ `resolver.failing` | ○ | ○ | ○ | ○ | ○ |
| `name.missing` | `dns` | ✓ 80 cases of `sim` | ✓ `name.missing` | ○ | ○ | ○ | ○ | ○ |
| `port.closed` | `tcp` | ✓ 80 cases of `sim` | ✓ `port.closed` | ○ | ○ | ○ | ○ | ○ |
| `filter.drop` | `tcp` | ✓ 80 cases of `sim` | ✓ `filter.drop` | ○ | ○ | ○ | ○ | ○ |
| `filter.reset` | `tcp` | ✓ 80 cases of `sim` | ✓ `filter.reset` | ○ | ○ | ○ | ○ | ○ |
| `tls.proxy` | `tls` | ✓ 80 cases of `sim` | ✓ `tls.proxy` | ○ | ○ | ○ | ○ | ○ |
| `tls.cert-invalid` | `tls` | ✓ 80 cases of `sim` | ✓ `tls.cert-invalid/expired`, `tls.cert-invalid/wrong-name` | ○ | ○ | ○ | ○ | ○ |
| `tls.mismatch` | `tls` | ✓ 80 cases of `sim` | ✓ `tls.mismatch` | ○ | ○ | ○ | ○ | ○ |
| `captive.portal` | `http` | ✓ 80 cases of `sim` | ✓ `captive.portal` | ○ | ○ | ○ | ○ | ○ |
| `server.slow` | `http` | ✓ 80 cases of `sim` | ✓ `server.slow` | ○ | ○ | ○ | ○ | ○ |
| `server.error` | `http` | ✓ 80 cases of `sim` | ✓ `server.error` | ○ | ○ | ○ | ○ | ○ |

| Proposed class | Layer | E0 | E1 | E2 | E3 | E4 | E5 | E6 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `link.flap` | `link` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `link.errors` | `link` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `link.slow` | `link` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `link.duplex` | `link` | ◌ | ◌ | ◌ | ◌ | ⊘ [1] | ◌ | ◌ |
| `link.storm` | `link` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `link.vlan` | `link` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `link.mac-table` | `link` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `link.mtu` | `link` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `link.port-blocked` | `link` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `wifi.down` | `wifi` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `wifi.flap` | `wifi` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `wifi.busy` | `wifi` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `wifi.multicast` | `wifi` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `wifi.power-save` | `wifi` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `wifi.refused` | `wifi` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `wifi.rogue` | `wifi` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `dhcp.none` | `ip` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `dhcp.rogue` | `ip` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `arp.spoof` | `ip` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `address.conflict` | `ip` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `dhcp.full` | `ip` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `address.wrong` | `ip` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `arp.stale` | `ip` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `ipv6.no-router` | `route` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `route.wrong` | `route` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `ipv6.rogue-router` | `route` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `nat.full` | `route` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `nat.hairpin` | `route` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `gateway.flap` | `route` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `path.delay` | `path` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `path.jitter` | `path` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `path.reorder` | `path` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `path.duplicate` | `path` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `path.corrupt` | `path` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `path.rate` | `path` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `path.queue` | `path` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `path.asymmetric` | `path` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `path.black-hole` | `path` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `path.loop` | `path` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `path.hijack` | `path` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `path.leak` | `path` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `path.flap` | `path` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `path.no-route` | `path` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `zone.unreachable` | `dns` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `zone.lame` | `dns` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `dns.wrong-record` | `dns` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `dns.intercept` | `dns` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `dns.poison` | `dns` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `cache.stale` | `dns` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `dnssec.bogus` | `dns` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `dns.blocked` | `dns` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `dns.tcp-blocked` | `dns` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `resolver.slow` | `dns` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `resolver.lossy` | `dns` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `resolver.limit` | `dns` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `resolver.clock` | `dns` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `dns.fragments` | `dns` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `dns.loop` | `dns` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `filter.ecn` | `tcp` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `nat.timeout` | `tcp` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `server.backlog` | `tcp` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `server.stall` | `tcp` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `tcp.options` | `tcp` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `tcp.proxy` | `tcp` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `clock.wrong` | `tls` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `tls.blocked` | `tls` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `tls.large-hello` | `tls` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `proxy.auth` | `http` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `cdn.stale` | `http` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `http.redirect-loop` | `http` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `server.limit` | `http` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `http.version` | `http` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |
| `cdn.wrong-content` | `http` | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ | ◌ |

- The key: ✓ covered. ◐ a gap: a case and no bar. ○ a gap: no case. ◌ a gap: no class in the catalog. ⊘ impossible on the layer. A covered cell names its cases.
- The layers, from [the table of S7](https://github.com/mark1russell7/systems/blob/main/docs/S7.md#the-layers):
  - E0: Code on a false clock. State: Today. It cannot prove: any real time.
  - E1: Processes and containers on one kernel. State: Today. It cannot prove: a second kernel, a separate clock, a reboot, a loss of power.
  - E2: A cluster of containers on one kernel. State: Today. It cannot prove: a kernel for each node, a loss of a node with no signal.
  - E3: A routed fabric of containers on one kernel. State: New. It cannot prove: the kernel or the forwarding hardware of a router.
  - E4: Virtual machines, each with its own kernel. State: New. It cannot prove: a physical NIC, real zones.
  - E5: Images of vendor routers in virtual machines. State: Later. It cannot prove: the forwarding chip of the router.
  - E6: Real hardware and clouds. State: Waits on the owner. It cannot prove: nothing that the plan covers.
- The reasons of the impossible cells:
  1. E4 cannot prove "A physical NIC". Thus it cannot have a physical NIC or its firmware. Source: S7, the table "The layers", row E4, column "What it cannot prove".
- The worlds: Simulated network (E0), Loopback (E1), Kernel (E1), Kernel, where cases (E1).
- The control `none`. Simulated network: 80 cases, a bar. Loopback: 1 case, a bar. Kernel: 1 case, a bar. Kernel, where cases: 1 case, no bar.

<!-- coverage:end -->

### The fault atlas

The fault atlas is data: `FAULT_ATLAS` in `packages/lab/src/atlas.ts` (ND-17). Each entry is a fault of real networks, with its layer, its signs, the world that can make it, and its sources. Each source is a section of an RFC or a public report, and each was read before it was cited.

- An entry with no class of the catalog is a gap of the catalog. The entry proposes a class.
- An entry of a class with no case is a gap of the labs. An entry with IPv6 counts only the cases of a world with IPv6.
- The same command writes these tables. The same unit test fails when they are not current.

<!-- atlas:start. The command `pnpm --filter @netdiag/lab roadmap` writes this part. Do not edit it. -->

| Layer | Entries | Covered | Gap: no bar | Gap: no case | Gap: no class |
| --- | --- | --- | --- | --- | --- |
| `link` | 2 | 1 | 0 | 0 | 1 |
| `wifi` | 3 | 1 | 0 | 0 | 2 |
| `ip` | 6 | 3 | 0 | 0 | 3 |
| `route` | 5 | 1 | 0 | 0 | 4 |
| `path` | 9 | 3 | 0 | 0 | 6 |
| `dns` | 9 | 3 | 0 | 0 | 6 |
| `tcp` | 5 | 3 | 0 | 0 | 2 |
| `tls` | 6 | 5 | 0 | 0 | 1 |
| `http` | 4 | 3 | 0 | 0 | 1 |
| All | 49 | 23 | 0 | 0 | 26 |

| World | Entries | Covered | Gap: no bar | Gap: no case | Gap: no class |
| --- | --- | --- | --- | --- | --- |
| Loopback | 13 | 12 | 0 | 0 | 1 |
| Kernel | 10 | 7 | 0 | 0 | 3 |
| containerlab | 19 | 2 | 0 | 0 | 17 |
| VMs | 7 | 2 | 0 | 0 | 5 |

- The atlas has 49 entries. 23 name a class of the catalog, and 26 have no class.
- The gaps of the catalog. The atlas proposes 25 classes:
  - `link.storm` (`link`, containerlab): `link.switching-loop`.
  - `wifi.busy` (`wifi`, VMs): `wifi.interference`.
  - `wifi.multicast` (`wifi`, VMs): `wifi.multicast-loss`.
  - `dhcp.none` (`ip`, containerlab): `ip.dhcp-no-lease`.
  - `dhcp.rogue` (`ip`, containerlab): `ip.dhcp-rogue`.
  - `address.conflict` (`ip`, containerlab): `ip.address-conflict`.
  - `ipv6.no-router` (`route`, VMs): `route.ipv6-no-advert`.
  - `ipv6.rogue-router` (`route`, VMs): `route.ipv6-rogue-advert`.
  - `nat.full` (`route`, containerlab): `route.nat-exhaustion`.
  - `nat.hairpin` (`route`, containerlab): `route.nat-no-hairpin`.
  - `path.black-hole` (`path`, containerlab): `path.dropped-prefix`.
  - `path.loop` (`path`, containerlab): `path.routing-loop`.
  - `path.asymmetric` (`path`, containerlab): `path.asymmetric-filter`.
  - `path.hijack` (`path`, containerlab): `path.bgp-hijack`.
  - `path.leak` (`path`, containerlab): `path.bgp-leak`.
  - `path.queue` (`path`, Kernel): `path.full-queue`.
  - `zone.lame` (`dns`, containerlab): `dns.lame-delegation`.
  - `dnssec.bogus` (`dns`, containerlab): `dns.dnssec-bogus`, `dns.dnssec-expired`.
  - `cache.stale` (`dns`, containerlab): `dns.stale-cache`.
  - `zone.unreachable` (`dns`, containerlab): `dns.authority-unreachable`.
  - `dns.fragments` (`dns`, Kernel): `dns.fragments-dropped`.
  - `filter.ecn` (`tcp`, Kernel): `tcp.ecn-blocked`.
  - `nat.timeout` (`tcp`, containerlab): `tcp.nat-idle-timeout`.
  - `clock.wrong` (`tls`, VMs): `tls.wrong-clock`.
  - `proxy.auth` (`http`, Loopback): `http.proxy-authentication`.

<!-- atlas:end -->

### The fault grammar

The fault grammar is data: `FAULT_GRAMMAR` in `packages/lab/src/grammar.ts` (ND-17). Each fault is a term: a layer, a mode, a place, a severity and an optional second fault.

- The grammar is a space of `@mark1russell7/strategy-space`. Thus each term has an id, and the space has counts and seeded samples.
- Each pair of a layer and a mode is an option, an alias of an option, or a reason. A test checks that each pair has one decision.
- The rules of the classes give each term its class. The class needs each trait that each of its terms needs.
- Each entry of the atlas has its term. A test fails when the term does not give the class of the entry. Thus the atlas checks that the grammar misses no real fault.
- The same command writes this table. The same unit test fails when it is not current.

<!-- grammar:start. The command `pnpm --filter @netdiag/lab roadmap` writes this part. Do not edit it. -->

- The grammar has 24 modes, 10 places and 87 options. Of the 216 pairs of a layer and a mode, 87 are options, 119 are aliases of an option, and 10 have a reason. The grammar gives 93 classes. The grid with 3 levels has 542 terms of one fault and 293,764 terms of two faults.

| Mode | link | wifi | ip | route | path | dns | tcp | tls | http |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `down` | `interface.down` | `wifi.down` | `host.down`, `dhcp.none` | `gateway.down` | `path.black-hole` | `zone.unreachable`, `resolver.down` | → `tcp/missing` | → `tcp/missing` | → `http/refuse` |
| `flap` | `link.flap` | `wifi.flap` | → `ip/rogue` | `gateway.flap` | `path.flap` | → `dns/loss` | → `tcp/missing` | → `tcp/missing` | → `http/refuse` |
| `loss` | → `link/corrupt` | `wifi.multicast`, `wifi.weak`, `wifi.busy` | → `path/loss` | → `path/loss` | `path.loss` | `resolver.lossy` | → `path/loss` | → `path/loss` | → `path/loss` |
| `corrupt` | `link.errors` | → `wifi/loss` | → `path/corrupt` | → `path/corrupt` | `path.corrupt` | → `dns/wrong` | → `path/corrupt` | → `path/corrupt` | → `http/wrong` |
| `delay` | → `path/queue` | `wifi.power-save` | → `path/delay` | → `path/delay` | `path.delay` | `resolver.slow` | → `tcp/exhaust` | → `http/delay` | `server.slow` |
| `jitter` | → `path/jitter` | → `wifi/loss` | → `path/jitter` | → `path/jitter` | `path.jitter` | → `path/jitter` | → `path/jitter` | → `path/jitter` | → `path/jitter` |
| `reorder` | → `path/reorder` | → `path/reorder` | → `path/reorder` | → `path/reorder` | `path.reorder` | → `path/reorder` | → `path/reorder` | → `path/reorder` | → `path/reorder` |
| `duplicate` | → `link/loop` | → `path/duplicate` | `address.conflict` | → `path/duplicate` | `path.duplicate` | → `path/duplicate` | → `path/duplicate` | → `path/duplicate` | → `path/duplicate` |
| `rate` | `link.slow` | → `wifi/loss` | → `path/rate` | → `path/rate` | `path.rate` | → `dns/exhaust` | → `path/rate` | → `path/rate` | → `http/exhaust` |
| `queue` | → `path/queue` | → `path/queue` | → `path/queue` | → `path/queue` | `path.queue` | → `path/queue` | → `path/queue` | → `path/queue` | → `path/queue` |
| `size` | `link.mtu` | → `link/size` | → `path/size` | → `path/size` | `path.mtu` with `path/filter` (kind `icmp-too-big`) | `dns.fragments` | → `path/size` | `tls.large-hello` | → `http/refuse` |
| `filter` | `link.port-blocked` | → `wifi/refuse` | `filter.icmp` | `nat.hairpin` | `path.asymmetric`, `path.mtu` with `path/size` | `dns.tcp-blocked`, `dns.blocked` | `filter.ecn`, `filter.drop` | `tls.blocked` | → `http/refuse` |
| `refuse` | → `link/filter` | `wifi.refused` | → `path/missing` | → `path/missing` | → `path/missing` | `resolver.failing` | `filter.reset` | → `tls/mismatch` | `proxy.auth`, `server.error` |
| `missing` | → `link/down` | → `wifi/down` | `ipv6.broken` | `ipv6.no-router` | `path.no-route` | `name.missing` | `port.closed` | → `tls/wrong` | ⊘ [1] |
| `wrong` | `link.vlan` | → `link/wrong` | `address.wrong` | `route.wrong` | `path.leak` | `zone.lame`, `dns.wrong-record` | → `dns/wrong` | `tls.cert-invalid` | `cdn.wrong-content` |
| `stale` | → `ip/stale` | → `ip/stale` | `arp.stale` | → `route/wrong` | → `path/down` | `cache.stale` | → `tcp/expire` | → `tls/expire` | `cdn.stale` |
| `rogue` | → `ip/rogue` | `wifi.rogue` | `arp.spoof`, `dhcp.rogue` | `ipv6.rogue-router` | `path.hijack` | `dns.poison` | → `tcp/refuse` | → `tls/intercept` | → `http/intercept` |
| `exhaust` | `link.mac-table` | → `wifi/refuse` | `dhcp.full` | `nat.full` | `path.black-hole` | `resolver.limit` | `server.backlog`, `nat.full` | → `http/exhaust` | `server.limit` |
| `expire` | → `link/filter` | → `wifi/flap` | → `ip/down` | → `route/missing` | → `path/flap` | `dnssec.bogus` | `nat.timeout` | `tls.cert-invalid` | → `tcp/expire` |
| `loop` | `link.storm` | → `link/loop` | → `path/loop` | → `path/loop` | `path.loop` | `dns.loop` | → `path/loop` | → `path/loop` | `http.redirect-loop` |
| `intercept` | → `ip/rogue` | → `wifi/rogue` | → `ip/rogue` | → `route/rogue` | → `path/rogue` | `dns.intercept` | `tcp.proxy` | `tls.proxy` | `captive.portal` |
| `mismatch` | `link.duplex` | → `wifi/refuse` | → `ip/wrong` | → `route/wrong` | → `path/size` | `dnssec.bogus` | `tcp.options` | `tls.mismatch` | `http.version` |
| `skew` | ⊘ [2] | → `tls/skew` | ⊘ [2] | ⊘ [2] | ⊘ [2] | `resolver.clock` | ⊘ [2] | `clock.wrong` | → `tls/skew` |
| `stall` | ⊘ [3] | → `wifi/loss` | ⊘ [3] | ⊘ [3] | ⊘ [3] | → `dns/down` | `server.stall` | → `tcp/stall` | → `tcp/stall` |

- The key: a cell names the classes of its option. → names the option of an alias. ⊘ names the reason that the pair has no fault.
- The reasons:
  1. A missing page is a fault of the program of the server or of the address, not of the network.
  2. The parts of this layer measure only intervals. They do not compare the time of a clock with a time in the data.
  3. Only a connection can stall: a part accepts it and then sends nothing. This layer has no connection.
- The rules of two faults:
  - `path/size` and `path/filter` (kind `icmp-too-big`), with one family: `path.mtu`. A small MTU on the path and a filter of the ICMP message that tells the size make a black hole for large packets.

<!-- grammar:end -->

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
| ND-9 | Views on the site | done | P2 | M | site | ND-8 | Demo 4 of the site reads a report of `netdiag check` and shows three views. The flow gives the state and the observations of each layer. The rings give the probability of each part of the network. The timeline gives the time of each fact. `readFact` and `readCheckReport` check the report, and the lab writes 13 sample reports (netdiag 0.4.1). |
| ND-10 | Wi-Fi facts for each operating system | done | P2 | M | probes | ND-1, ND-3 | The signal, the noise, the channel, the rate and the roams of the Wi-Fi link, as typed facts. Each operating system has its own adapter. Step 1: the adapters of `iw`, `system_profiler` and `netsh`, the reader of `wifi.signal` and `wifiChanges`. Step 2: the visit and `netdiag check` read the Wi-Fi link. The kernel lab has no Wi-Fi, so its agent does not read it. |
| ND-11 | The path through the providers | done | P2 | M | probes | ND-3 | The registered network and the holder of each hop of a route. Thus a fault gets the name of the provider network where it starts. The probe `rdap.owner` looks up each public hop in RDAP, at the registry of the bootstrap of IANA. `netdiag check --owners` sends the lookups through `polite-crawler`. The diagnosis names the networks where the loss of a path starts. Only ARIN gives an origin AS (netdiag 0.5.3). |
| ND-12 | Each probe of a visit as one candidate | done | P1 | S | diagnosis | ND-5 | `rankProbes` takes the 7 features of an HTTPS request (0.1.6). The limit of joint values is 65536. A test holds each probe of the package under it. |
| ND-13 | One HTTPS candidate in `netdiag check` | done | P2 | S | cli | ND-8, ND-12 | The next step of an `https` check takes the HTTPS request as one candidate with its 7 features, as the site demo does. The TLS handshake stays a cheaper candidate (netdiag-cli 0.3.0). |
| ND-14 | The start of a loss on the site | done | P3 | S | site | ND-9, ND-11, ND-15 | Demo 4 of the site shows where the loss of each path starts, and the networks of those hops. The data comes from the facts of a report, with `lossOrigins`. The sample report with a loss comes from the where cases of the kernel lab. The job `where` writes these samples, with the lookups of the owners and the origins. `lookupGrants` gives the grants of the lookups (netdiag 0.5.6, #51). |
| ND-15 | The lab gate of the start of a loss | active | P2 | M | ground truth | ND-11 | The where cases of the kernel lab put a loss on one link of the path, or no loss. Then `lossStart` must give the part of the path where the loss starts. Step 1 (#47): the cases and their records, with no bar. Step 2 (#48): the gate of the where cases. Step 3: the bars from 5 runs in CI, in `packages/lab/bars/where.json`. |
| ND-16 | The origin AS of each hop | done | P3 | S | probes | ND-11 | The AS number of each hop. In RDAP, only ARIN gives it. The second source is the DNS of Team Cymru, the source of `mtr -z`: a TXT query under `origin.asn.cymru.com` or `origin6.asn.cymru.com` gives the BGP prefix and its origin AS. `netdiag check --owners` shows the AS of each hop, and the two values when RDAP and the DNS do not agree (netdiag 0.5.5, #49). |
| ND-17 | netdiag learns on simulated networks | active | P2 | L | ground truth | ND-15 | The labs make each fault class of real networks in seeded worlds. A gap is not a pass. Each class must have a test on each layer E0 to E6 of the lab. The item is done only at zero gaps. Step 1: the coverage query, the fault atlas and the fault grammar. Step 2: the simulated world on E0, with 80 seeded cases of each class and their bars. Step 3: the weak points that the simulated world found, with its bars as the measure. The reaches of a fault as a set, the evidence of a broken family, the signs of a loss on a connect, the DNS tries, the evidence of a wired link, the DNS errors of a down interface and the MTU search below the floor of IPv6 are done. The evidence of a heavy loss is next. Step 4: one PR for each new class, with its features, its case and its bar. Step 5: seeded worlds of 3, 30 and 300 nodes in containerlab and in VMs of the harness (SYS-77), with fault plans of `rigor-chaos`. Step 6: a gate on the recall, the precision and the count of next probes, with a demo of each world on the site. |
