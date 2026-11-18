# @mark1russell7/netdiag

This package has the core model of netdiag. It has the typed facts at each layer of the stack, the contract of a probe and the scope rule. It also has the catalog of faults and the probability model.

**State: ND-1, ND-2, ND-4, the adapters of ND-3, and the lab score and the loopback lab of ND-7 of the [roadmap](../../docs/ROADMAP.md).** The kernel lab and the bars of the gate come next.

## Entries

| Entry | What it has |
| --- | --- |
| `@mark1russell7/netdiag` | All of the package: the core, the native probes and the visit of a target. |
| `@mark1russell7/netdiag/core` | All that imports no `node:` module. A browser can import it. |
| `@mark1russell7/netdiag/address` | The functions for IP addresses and networks. |
| `@mark1russell7/netdiag/diagnosis` | The probability model, the next probe and the lab score. |
| `@mark1russell7/netdiag/tools` | The adapters of outside tools. |

The core has the layers, the targets, the facts, the scope and the runner. It has the addresses, the diagnosis, the kinds of facts, the metrics and the readers. It also has the data of a visit and the limits of the echo requests. The readers of RDAP and of the DNS of Team Cymru are in it too.

## Facts

A fact has a layer, a time, a source and a value. Its kind names the type of its value, for example `tcp.connect`.

| Field | What it is |
| --- | --- |
| `id` | An id that is unique in the facts of one runner, for example `f12`. |
| `kind` | The name of the fact kind. The kind has the check of the value. |
| `layer` | One of `link`, `wifi`, `ip`, `route`, `path`, `dns`, `tcp`, `tls` and `http`. |
| `subject` | The target of the fact: a host and an optional port. |
| `time` | The start and the end, in milliseconds on the monotonic clock of the runner. |
| `source` | The probe, its version, and the outside tool when the probe starts one. |
| `value` | The value. It passes the check of its kind. |

A fact is plain data, so a record of facts is JSON.

`readFact(value, kinds)` reads a fact of JSON and checks each field. A fact of a kind of `kinds` also passes the check of its kind. The function does not check the value of a fact of another kind, so a record of a later version can have new kinds.

## Probes

A probe is an adapter. It tells if it is available, it does its work, and it parses its raw output into observations.

- `peers(input)` gives each host that the probe sends packets to. A passive probe gives no peers.
- `run(input, context)` does the effects and gives the raw output.
- `parse(raw, input)` is a pure function. A record of a raw output thus gives the same facts again.

A network failure is a fact, not an error. For example, a TCP connect that times out gives the outcome `timeout`.

`visitTarget` starts the standard probes of one target. Its option `probes` replaces each real probe that it names, with the keys of `VisitProbes`. A simulated world keeps the `parse` of the real probe and gives its own `run`. A probe of `probes` needs no port, but `pingCount`, `mtrCycles`, `mtu` and `wifi` still start or stop it.

## The scope rule

An active probe sends packets only to a peer that the user owns or names. The runner examines each peer before the probe starts.

| Basis | Why the target is in the scope |
| --- | --- |
| `named` | The user named the target for this diagnosis. |
| `owned` | The user declares that the user owns the network or the host. |
| `configured` | The configuration of the computer names it, for example the gateway or the DNS resolver. |
| `resolved` | A DNS answer for a granted name gave this address. |

The scope also limits the number of ports of each host. The default limit is 8. Thus netdiag does no port scan.

## IP addresses

The entry `@mark1russell7/netdiag/address` has plain functions for IP addresses and networks. It imports no module of Node, so a browser can also use it.

| Function | What it gives |
| --- | --- |
| `ipVersion(text)` | `4`, `6`, or `0` for a text that is not an IP address. It gives the value of `isIP` of `node:net`. |
| `addressFamily(address)` | `ipv4`, `ipv6`, or `undefined` for a text that is not an address. |
| `addressClass(address)` | The class of the address, from the special-purpose ranges of RFC 6890. |
| `addressKind(address)` | `private` for an address that the internet does not route to, else `public`. |
| `parseCidr(text)` | A CIDR range, or the problem of the text. |
| `cidrSet(ranges)` | A set of ranges. Its `has(address)` tells if an address is in a range of the set. |

- The classes are `unspecified`, `loopback`, `private`, `shared`, `link-local`, `unique-local`, `documentation`, `benchmarking`, `multicast`, `reserved` and `public`.
- The table `ADDRESS_CLASSES` holds the ranges of the classes as data.
- An IPv4 address in IPv6 form, for example `::ffff:192.0.2.1`, is its IPv4 address.
- An IPv4 address is also in an IPv6 range that holds its IPv6 form, as for `BlockList` of `node:net`.
- Tests compare `ipVersion` and `cidrSet` with `isIP` and `BlockList` on random addresses.
- An address for documentation is `public`. Thus a lab can use `203.0.113.0/24` for hosts on the internet.

```ts
import { addressClass, cidrSet, parseCidr } from "@mark1russell7/netdiag/address";

addressClass("100.64.0.1"); // "shared": the carrier-grade NAT range
const lab = parseCidr("203.0.113.0/24");
if (lab.tag === "ok") cidrSet([lab.value]).has("::ffff:203.0.113.7"); // true
```

## Native probes

The native probes use only the `node:` modules. They need no outside tool.

| Probe | Id | Facts |
| --- | --- | --- |
| `DNS_PROBE` | `dns.query` | `dns.answer`: the outcome, the addresses, the lowest TTL and the tries of one query for `A` or `AAAA` records. |
| `tcpProbe()` | `tcp.connect` | `tcp.connect`: the outcome and the time of one connect. |
| `tlsProbe()` | `tls.handshake` | `tcp.connect` and `tls.handshake`: the time of the handshake, the version, the cipher, ALPN and the certificate. |
| `httpProbe()` | `http.request` | `tcp.connect`, `tls.handshake` for `https`, and `http.response`: the status, some fields of the head and the time to the first byte. |
| `LINK_PROBE` | `link.state` | `link.state`: the interfaces that are up, and the interface of the network of the gateway. |

- A probe connects only to an IP address. The DNS probe gives the addresses of a name first. Thus the runner examines each address against the scope.
- The peer of the DNS probe is the resolver, not the name.
- The DNS probe sends a query again after a loss, `DNS_TRIES` (3) times or fewer. The input `tries` changes the count, from 1 to `MAX_DNS_TRIES` (10).
- The tries share the time limit of the query, and the wait does not double. An error answer, for example `SERVFAIL`, starts no new try. `nodeResolveTxt` does the same.
- With one try, a loss of 30 % in each direction makes 51 % of the queries time out. With 3 tries, it makes 13 % time out.
- A time limit or a stop of the signal closes the socket. The probe then gives the outcome `timeout`, or the runner gives `aborted`.
- The TLS probe does not refuse a certificate that is not valid. It records the problem, for example `expired`, `name` or `untrusted`.
- The trust tells the root of the chain. `public` is a root of Node.js. `private` is a different root, for example the root of a proxy that examines TLS.
- The option `roots` adds roots that the user trusts, for example the root of a company. Their trust is `private`.
- The option `publicRoots` adds roots with the trust `public`. A lab gives its own root here, so its servers stand for servers on the internet.
- The HTTP probe follows no redirect. It reads the body up to 64 KiB.
- The link probe is passive. It reads `os.networkInterfaces()` and sends no packet. Node.js lists only the interfaces that are up.
- For `https`, the HTTP probe sends its request only when the certificate passes its check. Thus an interceptor does not get the path.

```ts
import { realClock } from "@mark1russell7/algebra/clock";
import { TCP_PROBE, createRunner, scopeOf } from "@mark1russell7/netdiag";

const scope = scopeOf([{ kind: "range", cidr: "192.168.1.0/24", basis: "owned" }]);
if (scope.tag === "err") throw new Error(scope.error.join(" "));

const runner = createRunner({ scope: scope.value, clock: realClock });
const outcome = await runner.run(TCP_PROBE, { address: "192.168.1.1", port: 443 });
// The fact tcp.connect has the outcome connected, refused, timeout, unreachable, reset or error.
```

## Outside tools

The entry `@mark1russell7/netdiag/tools` has optional adapters of outside tools. netdiag bundles no tool. The user installs each tool.

| Probe | Id | Tool | Facts |
| --- | --- | --- | --- |
| `pingProbe(host)` | `icmp.ping` | `ping` | `icmp.echo`: the echo replies, their round-trip times, and the messages of an unreachable address. |
| `mtuProbe(host)` | `path.mtu` | `ping` | `path.mtu`: the MTU of the path, and how the path stops a larger packet: with a message or with no message. |
| `tracerouteProbe(host)` | `path.traceroute` | `traceroute`, `tracert` on Windows | `path.trace`: the routers that answered each TTL, their round-trip times, and the messages of an unreachable address. |
| `mtrProbe(host)` | `path.mtr` | `mtr` (Linux and macOS) | `path.report`: the loss and the round-trip times of each hop over many cycles. |
| `iperf3Probe(host)` | `path.iperf3` | `iperf3` (3.1 or later) | `path.throughput`: the rates of the sender and the receiver, the TCP retransmits, the UDP jitter and loss, and each interval. |
| `captureProbe(host)` | `path.capture` | `tshark` | `path.capture`: the packets of one flow, with the time, the addresses, the ports and the TCP fields of each packet. |
| `wifiProbe(host)` | `wifi.link` | `iw` on Linux, `system_profiler` on macOS, `netsh` on Windows | `wifi.link`: the state, the access point, the signal, the noise, the channel and the rates of each Wi-Fi interface. `wifi.interfaces`: the names of all the Wi-Fi interfaces, possibly none. |

- A host starts each tool. Its `run(command, args, options)` starts a program with a list of arguments and no shell.
- `commandHost(runner, platform)` makes a host from a function with the shape of `runCommand` of `@procedures/shell`. A test gives a fake host.
- netdiag does not depend on `@procedures/shell`. The caller gives the function.
- An adapter reads only English output. On Linux and macOS, it sets `LC_ALL=C`. On Windows, the language of the system sets the output.
- On Linux, the adapter reads the `ping` of iputils. On macOS, it uses `ping6` for an IPv6 address.
- The probe `path.mtu` starts `ping` with "do not fragment" for each size of the search. On macOS and Windows, it supports only IPv4.
- On Linux, the trace adapter reads the Modern traceroute (the package `traceroute`). On macOS, it uses `traceroute6` for an IPv6 address.
- The `mtr` adapter reads the JSON report of `mtr --json` (version 0.92 or later). The default of 20 cycles takes approximately 20 seconds.
- The `iperf3` adapter reads the JSON report of `iperf3 -J`. The user operates the server. A UDP test always has a target rate, 1 Mbit/s by default.
- The capture adapter builds the capture filter from typed fields: an address, a port and a protocol. It does not accept free text.
- A capture needs the privilege to capture on the interface. The adapter does not use promiscuous mode or name lookups.
- The scope rule applies to the server of `iperf3` and to the address of a capture, as to the other adapters.
- The Wi-Fi adapter reads the state of the radio and sends no packet. Its facts have the subject `localhost`.
- On Linux, the Wi-Fi adapter starts `iw dev`. For each managed interface, it then starts `iw dev <name> link` and `iw dev <name> survey dump`.
- macOS 14.4 and later have no `airport` tool. The adapter reads the JSON report of `system_profiler SPAirPortDataType`.
- On Windows 11, `netsh` needs the location permission. Without it, the adapter fails with the step that gives the permission.
- macOS and Windows hide the name of the network without the location permission. The fact then has no `ssid`.
- The estimators of ND-6 read the facts `path.throughput` and `path.capture`. This step has no readers for them.
- Output that netdiag cannot read gives the outcome `error` with the reason. It does not give a reply that did not occur.
- The table `TOOL_LICENSES` holds the license of each tool as data. A tool with a restrictive license has no adapter.

```ts
import { runCommand } from "@procedures/shell/command";
import { commandHost, pingProbe } from "@mark1russell7/netdiag/tools";

const host = commandHost(runCommand, process.platform);
// The runner comes from the example of the native probes.
const outcome = await runner.run(pingProbe(host), { address: "192.168.1.1", count: 20 });
```

## The owners of a path

The probe `ownerProbe(get)` gives the fact `path.owner` for each address of a path. The fact has the registered network of the address, its holder and its country.

- The probe looks up only public addresses. A private or shared address gets the outcome `special` and no lookup.
- The bootstrap files of IANA (RFC 9224) give the registry of each address. The probe sends each lookup with `https` only.
- The peers are `data.iana.org` and the five registries of `RDAP_REGISTRIES`. The lookups send the addresses of the path to the registries, so the user must name these peers in the scope.
- The port `get` sends one GET request. The command-line tool gives a port over `send` of `polite-crawler/api`, which keeps the pace of each registry.
- Only ARIN gives the origin AS numbers of a network, with the extension `arin_originas0`.
- A visit with the option `owners` (a port) and `mtrCycles` looks up the hops of each fact `path.report`. It looks up each hop one time.

The core has the readers of RDAP: `readBootstrap`, `serviceFor` and `readNetwork`.

## The origins of a path

The probe `originProbe(resolve)` gives the fact `path.origin` for each address of a path. The fact has the BGP prefix of the address and its origin AS numbers.

- The source is the DNS of Team Cymru. `mtr -z` uses the same source.
- The probe sends one TXT query for each public address. A private or shared address gets the outcome `special` and no query.
- An IPv4 query has the parts of the address in the reverse order, under `origin.asn.cymru.com`.
- An IPv6 query has the 32 hexadecimal digits of the address in the reverse order, under `origin6.asn.cymru.com`.
- The answer has the form `AS numbers | prefix | country | registry | date`. The parser refuses an answer of a different form.
- The outcome NXDOMAIN gives the outcome `unrouted`: no BGP route holds the address.
- The country is a field of the registry record. It is not the location of the address.
- The peers are the resolver and the zones of `CYMRU_ZONES`. The queries send the addresses of the path to Team Cymru, so the user must name the zones in the scope.
- The port `resolve` sends one TXT query. `nodeResolveTxt` is a port over `node:dns`. The probe sends `ORIGIN_CONCURRENCY` (4) queries at a time or fewer.
- The queries do not go through `polite-crawler`, because `polite-crawler` has no DNS transport.
- A visit with the option `origins` (a port), a resolver and `mtrCycles` looks up the hops of each fact `path.report`.

`LOOKUP_KINDS` has the fact kinds `path.owner` and `path.origin`. The core has the readers of the DNS of Team Cymru: `originQuery` and `readOrigin`.

`lookupGrants(reason)` gives the grants by name of each peer of the two probes, except the resolver. A check adds them only when the user asks for the lookups.

## Diagnosis

The entry `@mark1russell7/netdiag/diagnosis` has the probability model. It imports no `node:` module, so a browser can also use it.

- A feature is a discrete observation. For example, `tcp.connect` has the values `connected`, `refused`, `timeout`, `unreachable` and `reset`.
- Each feature has a healthy distribution: the probability of each value when there is no fault.
- A fault names a part of the network, the layer where it starts and the feature values that it predicts. The other features keep their healthy distributions.
- The hypotheses are `none` (no fault), each fault of the catalog, and `unknown` (a cause that the catalog does not have).
- The hypothesis `unknown` gives the same probability to each value. Thus it wins when no fault of the catalog explains the observations.

| Function | What it gives |
| --- | --- |
| `diagnose(catalog, evidence)` | The probability of each hypothesis, from the most probable. The model is naive Bayes with logarithms. |
| `explain(catalog, evidence, id)` | The weight of each observation for a cause: the `log10` of its likelihood ratio against `none`. |
| `predictive(catalog, diagnosis, feature, primary)` | The probability of each value of a feature before a probe observes it. |
| `rankProbes(catalog, diagnosis, candidates, options)` | The candidate probes from the largest expected information gain over the causes, in bits. The first candidate is the next probe. |

### The next probe

`rankProbes` gives the expected information gain of each candidate: the mutual information of the causes and the features of the candidate.

- A candidate names the features that its facts give. `featuresOf(probe.kinds, { gateway })` of the readers gives them.
- The model takes the features as independent for a cause. Thus the probability of a joint value is the product of the probabilities of its values.
- A feature that the evidence has, with the same role, adds nothing. A second observation of a feature is not independent of the first observation.
- With the option `top`, the gain tells apart only the most probable causes. The other causes count as one group.
- When two gains are equal, the lower `cost` comes first.
- The entropy and the gain come from `@mark1russell7/rigor-statistics`.

After a DNS timeout, the ping of the gateway comes first. Its reply tells a down resolver from a down gateway or interface.

Evidence with `primary: false` comes from a reference host, for example a second public server. A fault with the reach `target` does not change the reference host. A fault with the reach `shared` changes both hosts. Thus a slow TLS handshake on both hosts points to a TLS proxy.

A fault with the reach `upstream` changes both hosts past the gateway. It does not change the local features, for example `gateway.loss`. Thus a loss of the path with no loss to the gateway points to a loss past the gateway.

A fault can have more than one reach. For example, a loss can be in the local network, past the gateway or near the target. The diagnosis then gives one variant of the fault for each reach, with its share of the prior from `Fault.reachShares`, or an equal share. The probability of the fault is the sum of its variants. `Cause.reaches` gives the probability of each reach, and `causeVariants` gives the variants of a cause. The choice of the next probe and `predictive` use these variants.

A fault can also have degrees. A degree is a severity, for example the size of a loss, or a mode, for example a silent or an absent resolver. Each degree has a part of the prior of the fault, and predictions that replace the predictions of the fault. The model sees the timeouts together: a large loss makes DNS, TCP and HTTP time out together, and a small loss does not. The variants of a fault are each pair of a reach and a degree. `Cause.degrees` gives the probability of each degree.

A mode is the same on each subject of a visit. A down resolver drops each query, or its host refuses each query. Thus each mode is a degree with one expected value, and the model counts the mode once for each visit. `interface.down`, `gateway.down`, `resolver.down`, `resolver.failing` and `host.down` each have two modes.

The degrees of a loss are a grid of the chance q that one exchange loses a packet. `LOSS_DEGREES` has the grid: 0.05, 0.15, 0.3, 0.5, 0.7 and 0.9. Each degree below 0.5 has 3 parts of the prior, and each other degree has 1. The predictions of each degree come from the tries of each step of a visit, in `LOSS_STEPS`. A step with k tries times out with the chance q^k. A step that passes was late when it lost its first try, and its time lands in the late bins of the step.

An echo request is one exchange. Thus the bins of `path.loss` and `gateway.loss` follow the binomial distribution of the lost requests of 20, for the visits with one reply or more. One lost request of 20 is a weak sign of a loss. A loss of 0.05 gives it in 38 of 100 visits, and a healthy path gives it in 8 of 100.

The standard catalog `STANDARD_CATALOG` has 18 features and 21 faults. The rules of practice give its first likelihoods, and each hypothesis has the same prior. The lab runs (ND-7) then fit these numbers.

```ts
import { STANDARD_CATALOG, diagnose } from "@mark1russell7/netdiag/diagnosis";

const result = diagnose(STANDARD_CATALOG, [
  { feature: "icmp.reply", value: "none", primary: true },
  { feature: "tcp.connect", value: "connected", primary: true },
]);
// result.causes[0].id is "filter.icmp": a filter blocks ICMP, and the host is up.
```

## Readers

`readEvidence(facts, options)` changes the facts of the native probes and of the adapters into evidence for the model. Each value that it gives is a value of a feature of `STANDARD_CATALOG`.

| Feature | The source of the value |
| --- | --- |
| `dns.answer` | The outcome of each DNS query. One answer `ok` for a name and a resolver decides. `nodata` gives `ok`, because the name exists. c-ares gives `unreachable` when it cannot send the query, or when no DNS service listens on the resolver. |
| `dns.address` | The addresses of a public name. One private address decides. A local name, for example `nas.local`, gives no value. |
| `ip.family` | The TCP connects to the IPv4 and the IPv6 addresses of one name. When one family is broken, the other facts of its addresses give no second feature. |
| `tcp.connect`, `tcp.time` | The outcome and the time of each TCP connect. A time of 900 ms or more tells that the SYN went again. |
| `tls.handshake`, `tls.trust` | The outcome of the handshake and the root of the certificate chain. A chain with no root of the store gives `private`. |
| `tls.ratio` | The time of the handshake divided by the time of the last TCP connect to the same address and port. A connect that sent its SYN again gives no ratio, because its time is not a round trip (Karn's rule). |
| `http.status`, `http.ttfb` | The class of the status, and the time to the first byte divided by the time of the TCP connect. A connect that sent its SYN again gives no ratio (Karn's rule). |
| `link.state` | The link fact of each gateway. An interface that is up on the network of the gateway gives `up`. With no gateway, an interface that is up and not loopback gives `up`. |
| `gateway.reply` | The echo requests to the address of the option `gateway`. An unreachable gateway gives `none`. |
| `gateway.loss` | The share of the echo requests to the gateway with a reply, with the bins of `path.loss`. A report of `mtr` to the gateway gives it too. |
| `icmp.reply` | The echo requests to each other address: `reply`, `none` or `unreachable`. |
| `path.mtu` | A measured MTU: `full` at the ceiling, `reduced` with a message of a router, `silent` with no message. `silent` tells an MTU black hole. |
| `path.loss` | The share of the echo requests with a reply, for 20 requests or more: `none`, `some` (up to 5 % loss), `high` or `most` (more than half lost). A report of `mtr` that reached the address gives it from its last hop. The gateway gives `gateway.loss` in its place. |
| `wifi.signal` | The signal level of each connected Wi-Fi interface: `strong` at -60 dBm or more, `weak` below -75 dBm. The quality of Windows changes to dBm. |
| `wifi.state` | `connected` when a Wi-Fi fact tells of a connected interface. A fact `wifi.interfaces` with no connected interface gives `none`. Then `wifi.weak` is not the cause. |

- The reader gives one evidence for each feature, subject and role. When a subject has more facts, the last fact decides.
- A fact that gives no evidence goes in `skipped`, with the reason. For example, the catalog has no value for the TLS outcome `not-tls` yet.
- When `ip.family` marks one family of a name as broken, a fact of an address of that family gives only `ip.family`. The echo, the handshake and the MTU facts of that address go in `skipped`. Thus the model does not count one failure two times.
- A fact `path.trace` gives no evidence yet. The catalog has no feature for the hops of a path. The lab runs (ND-7) fit one.
- The option `primary` tells which facts are about the target. The other facts are about a reference host.
- The option `gateway` gives the IP address of the default gateway.
- `FEATURE_SOURCES` gives the fact kinds that each feature needs. `featuresOf(kinds, { gateway })` gives the features that the facts of some kinds can give. A test holds the table against the readers.

```ts
import { STANDARD_CATALOG, TCP_PROBE, diagnose, readEvidence } from "@mark1russell7/netdiag";

// The runner comes from the example of the native probes.
const outcome = await runner.run(TCP_PROBE, { address: "192.168.1.1", port: 443 });
if (outcome.status === "done") {
  const { evidence, skipped } = readEvidence(outcome.facts);
  const result = diagnose(STANDARD_CATALOG, evidence);
  // A connect with the outcome refused gives result.causes[0].id "port.closed".
}
```

## Metrics

The estimators read the values of the facts. Each time is in milliseconds. The statistics come from [`@mark1russell7/rigor-statistics`](https://github.com/mark1russell7/rigor).

| Function | It gives |
| --- | --- |
| `rfc3550Jitter(delays)` | The interarrival jitter of RFC 3550: `J += (abs(D) - J) / 16`. `D` is the change of the delay between two packets in sequence. |
| `ipdv(delays)`, `pdv(delays)` | The IP packet delay variation of RFC 3393 for each pair in sequence, and the PDV of RFC 5481: each delay less the smallest delay. |
| `delayMetrics(delays)` | The smallest, median, mean and largest delay, the standard deviation, the jitter, the median absolute IPDV and the quantile 0.99 of the PDV. |
| `lossOf(sent, received)` | The share of the lost packets of RFC 7680, with its Wilson interval at 95 %. |
| `echoMetrics(echo)` | The loss and the delay summary of an `icmp.echo` fact. The loss of a round trip is an upper bound of the one-way loss of each direction. |
| `ackSamples(capture)` | The RTT samples of a `path.capture` fact: the ACKs of the remote host. By the rule of Karn, an ACK of a retransmitted segment gives no sample. |
| `rtoOf(samples, options)` | The RTO of RFC 6298: `SRTT + max(G, 4 * RTTVAR)`, from 1 second to 60 seconds by default. |
| `wifiSignalOf(link)` | The signal level of a connected Wi-Fi link, in dBm. The quality of Windows gives the level `quality / 2 - 100`. |
| `wifiChanges(facts)` | The roams, the drops, the joins and the changes of network and channel of each Wi-Fi interface, and the summary of its signal. |
| `packetPairs(capture)`, `bandwidthOf(capture)` | The capacity of the narrowest link, from the gap between two full segments of a burst at the receiver. `bandwidthOf` gives the median of the pairs. |

```ts
import { ackSamples, echoMetrics, rtoOf } from "@mark1russell7/netdiag";

// An echo fact with 20 requests and 19 replies gives a loss of 0.05 and the jitter of its round-trip times.
const { loss, delay } = echoMetrics(echo);
// The RTO from the ACKs of a capture of one flow.
const rto = rtoOf(ackSamples(capture), { minMs: 200 });
```

### The start of a loss

`lossStart(report)` gives the part of the path of a `path.report` fact where the loss to the destination starts. A router can drop its own answers to `mtr` and pass the other packets. So the loss of one hop tells only a little.

- A loss of the path continues to each later hop and to the destination.
- An exact binomial test examines each hop before the destination. The claim is "the loss of the hop is the low end of the destination loss, or more".
- The correction of Holm at the level `LOSS_START_LEVEL` (0.05) finds the hops with a clearly lower loss.
- The loss starts after the last of these hops. With few cycles, no hop has a clearly lower loss, and the part is the whole path.
- `lossNetworks(start, owners, origins)` puts the hops of the part in their networks, from the `path.owner` facts. A hop with no found owner goes in the network of its origin AS. `lossOrigins(facts)` does the two steps for each report of a visit.

### The MTU of a path

`nextMtuSize(tries, bounds)` gives the next size of a search, and `mtuOf(address, tries, bounds)` gives the value of a fact `path.mtu`. The state of a search is its list of tries, so a test can replay a search with no tool.

- Each size is the size of an IP packet. The floor is 68 bytes for IPv4 and 1280 bytes for IPv6. The default ceiling is 1500 bytes.
- The second size is the floor. When the floor of IPv6 fails, the search tries a plain echo request of 104 bytes.
- A path that passes 104 bytes and drops 1280 bytes has a link with an MTU below the minimum of IPv6. The search finds that MTU.
- The first size is the ceiling. Most paths pass it, so most searches end after one try.
- A message of a router can tell the MTU. The search tries that MTU and one byte above it.
- A path that drops a large packet with no message is an MTU black hole. The search finds its MTU by halves.
- After a false message, the search uses no message. A search has at most `4 + 3 * ceil(log2(ceiling - floor))` tries. With `least`, it has one more try, and `least` replaces `floor`.

## The lab score

A lab makes one fault on purpose. Then netdiag must name it. The entry `@mark1russell7/netdiag/diagnosis` has the score of these runs.

| Function | What it gives |
| --- | --- |
| `labRecordOf(catalog, case, truth, diagnosis)` | The record of one run: the true hypothesis, the predicted cause, the rank of the truth and the probability of each cause. |
| `scoreLab(catalog, records)` | The confusion table, the recall of each hypothesis with its Wilson interval, the accuracy and the mean Brier score. |
| `labGate(score, bars)` | A verdict for each hypothesis with a bar: `pass`, `fail` or `no-read`. |
| `labBars(scores, options)` | The bars of the gate from the scores of 5 or more runs of one lab. |

- The recall of a hypothesis is the part of its runs where the diagnosis names it.
- A hypothesis passes when the lower end of its recall interval is its bar or more.
- A hypothesis with no runs gets `no-read`, and the gate does not pass.
- A hypothesis with no bar goes in `unbarred`, for example a fault that no lab can make.
- The bar of a hypothesis is the least lower end of its recall over the runs, minus the spread of these lower ends.
- The spread is `noiseFloor` of `@mark1russell7/rigor-statistics`: 2 standard deviations, or `k` with the option `k`.
- `labBars` rounds each bar down to `LAB_BAR_STEP` (0.001). A bar is 0 or more.
- A hypothesis with a read in only some runs is an error. A hypothesis with no read in each run gets no bar.
- `labGate` and `labBars` read only a `LabRecalls`: the catalog, and the support and the recall interval of each class.
- A `LabScore` is a `LabRecalls`. A lab with no catalog of faults gives a `LabRecalls` for its cases, and uses the same gate.

```ts
import { STANDARD_CATALOG, diagnose, labGate, labRecordOf, scoreLab } from "@mark1russell7/netdiag/diagnosis";

const diagnosis = diagnose(STANDARD_CATALOG, [{ feature: "tcp.connect", value: "refused", primary: true }]);
const record = labRecordOf(STANDARD_CATALOG, "port.closed/refused", "port.closed", diagnosis);
if (record.tag === "err") throw new Error(record.error);

const score = scoreLab(STANDARD_CATALOG, [record.value]);
if (score.tag === "err") throw new Error(score.error.join(" "));
const gate = labGate(score.value, { "port.closed": 0.1 });
// gate.value.verdicts[0].status is "pass": the lower end of the recall of 1 run of 1 is 0.21.
```

## Example

```ts
import { fakeClock } from "@mark1russell7/algebra/clock";
import { createRunner, namedGrant, parseTarget, scopeOf } from "@mark1russell7/netdiag";

const named = parseTarget("https://example.com");
if (named.tag === "err") throw new Error(named.error);
const scope = scopeOf([namedGrant(named.value)]);
if (scope.tag === "err") throw new Error(scope.error.join(" "));

const runner = createRunner({ scope: scope.value, clock: fakeClock() });
// runner.run(probe, input) gives the outcome: done, refused, unavailable, failed or aborted.
```

## License

[MIT](../../LICENSE)
