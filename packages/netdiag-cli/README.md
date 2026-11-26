# @mark1russell7/netdiag-cli

The command line of netdiag. The command `netdiag check` probes a target. Then it gives the probable causes of a fault, their probabilities and the next step.

**State: ND-8 of the [roadmap](../../docs/ROADMAP.md).** The core model is in [`@mark1russell7/netdiag`](../netdiag/README.md). This package keeps the dependencies of the command line out of the core.

## Install

```sh
npm install --global @mark1russell7/netdiag-cli
```

The program needs Node.js 22.12 or later. The program `ping` is optional. Without it, the check sends no ICMP echo request.

## The command

```sh
netdiag check <target> [options]
```

The target is a DNS name, an IP address, `host:port` or a URL. A URL also gives the scheme, the port and the path.

The check has these steps:

1. It reads the link and the Wi-Fi link of this computer. These reads send no packet. The Wi-Fi read uses `iw` on Linux, `system_profiler` on macOS and `netsh` on Windows.
2. It asks the DNS resolver for the IPv4 and IPv6 addresses of each name.
3. It pings each address, connects to it, does the TLS handshake and sends one HTTP request.
4. It searches the MTU of the path to an address when the TLS handshake or the HTTP response times out after a TCP connect.
5. It reads the facts into evidence. The catalog of faults gives the probability of each cause.
6. It finds the probe with the largest information gain over the 3 most probable causes. This probe is the next step.

## The options

| Option | Default | What it does |
| --- | --- | --- |
| `--port <port>` | The port of the target, then the port of the scheme | It sets the port of the HTTP request, from 1 to 65535. |
| `--scheme <scheme>` | The scheme of a URL, then `https` | It sets the scheme of the HTTP request: `http` or `https`. |
| `--path <path>` | The path of a URL, then `/` | It sets the path of the HTTP request. The path starts with `/`. |
| `--reference <host>` | None | It adds a host that works for you. The check probes it for a comparison. Give the option again for more hosts. |
| `--resolver <address>` | The first resolver of the computer | It sets the DNS resolver: an IP address with an optional port. |
| `--gateway <address>` | None | It adds the IP address of your router. The check pings it. |
| `--grant <cidr>` | None | It adds a CIDR range that you own. Give the option again for more ranges. |
| `--ping-count <count>` | 4 | It sets the number of echo requests to each address, from 0 to 100. A measure of the loss needs 20 or more. |
| `--mtu`, `--no-mtu` | A search after a time-out | `--mtu` searches the MTU of the path to each address. `--no-mtu` starts no search. |
| `--mtr-cycles <count>` | 0, or 20 with `--owners` | It sets the number of cycles of `mtr` to each address, from 0 to 100. 0 starts no `mtr`. |
| `--owners` | Off | It looks up the owner network of each hop of `mtr` in the registries of RDAP, and its origin AS in the DNS of Team Cymru. |
| `--json` | Off | It writes the whole report as JSON. |
| `--help` | Off | It shows the options. |
| `--version` | Off | It shows the version. |

netdiag starts `mtr` only on Linux and macOS. Thus `--owners` gives no owner and no origin AS on Windows.

The exit code is 0 after a check. It is 1 for an option that is not valid. A fault of the network does not change the exit code.

## The scope rule

netdiag sends packets only to the hosts that you name or own. The check grants only these hosts:

- the target and each reference host
- the DNS resolver, from `--resolver` or from the computer
- the gateway, when you give `--gateway`
- each range of `--grant`
- each address that the resolver gives for a granted name
- with `--owners`, the bootstrap host of IANA (`data.iana.org`) and the RDAP host of each regional registry
- with `--owners`, the DNS zones of Team Cymru (`origin.asn.cymru.com` and `origin6.asn.cymru.com`)

The check sends no packet to another host. A grant with a problem stops the check before the first probe. Thus a typing error cannot make the scope wider.

The lookups of `--owners` send the address of each public hop to its registry, over HTTPS. They go through `polite-crawler`, so each registry gets one request at a time, with a rest between two requests. A registry that refuses netdiag stops for the rest of the check.

The lookups of `--owners` also send a TXT query for each public hop to the DNS resolver. The name of the query has the address of the hop, so the resolver sends it to Team Cymru. The answer gives the BGP prefix and the origin AS of the hop. The check sends 4 queries at a time or fewer.

## The output

In this example, no program listens on port 443 of the target. The reference host works. The names and the addresses are examples.

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

With `--owners`, the text also shows the owner and the origin AS of each hop. When RDAP and the DNS of Team Cymru give different AS numbers, the text shows the two values. The addresses and the networks are examples.

```text
The owners of the hops (4)
  10.0.0.1: a special-purpose address (private), with no lookup
  8.8.4.4: EXAMPLE-8 (NET-8-8-4-0-1), Example Networks Inc., US, AS64500
  8.8.4.9: EXAMPLE-8 (NET-8-8-4-0-1), Example Networks Inc., US, AS64500 in RDAP, AS64511 in the DNS of Team Cymru
  45.0.0.9: the registry has no network for this address, AS64502
```

When the destination of `mtr` has a loss, the cause "A network on the path loses packets" names the networks where the loss can start. The section "Where the loss starts" gives the hops of each network. The loss starts after the last hop with a clearly lower loss. 100 cycles give a shorter part of the path than 20 cycles.

```text
Where the loss starts (1)
  The loss of 10% to 192.0.2.10 starts in one of 2 networks: TRANSIT-NET (AS64501) or SHOP-NET.
    The loss starts after hop 2 (198.51.100.1), a hop with a clearly lower loss.
    hop 3 (203.0.113.1): TRANSIT-NET (NET-T), AS64501
    hop 4 (192.0.2.10): SHOP-NET (NET-S)
```

The probabilities come from the evidence of this check only. The next step is the option or the probe that gives the most information about the 3 most probable causes. Its gain is in bits. A small gain tells that no probe can change the probabilities much.

## The JSON report

The option `--json` writes the object `CheckReport` in the format `netdiag-check/1`.

| Field | What it is |
| --- | --- |
| `format` | The text `netdiag-check/1`. |
| `target`, `scheme`, `path` | The target as `host` or `host:port`, and the HTTP request. |
| `grants` | The grants of the scope of the check. |
| `causes` | Each cause with its probability, from the most probable. |
| `next` | The next step, or `null` when no probe can tell more. |
| `choices` | Each next step with a gain, from the largest gain. |
| `problems` | Each probe that did not end, with its role and its host. |
| `evidence` | The evidence that the diagnosis used. |
| `ignored`, `skipped` | The evidence and the facts that the diagnosis did not use, with the reason. |
| `facts` | Each fact of the visit, with its role and its host. |

`readCheckReport(value)` reads a report of JSON and checks it. The checks are these:

- Each field has its type, and each fact passes `readFact` of netdiag.
- The causes go from the most probable, and their probabilities sum to 1.
- `next` is the first of `choices`, and each fact id is unique.
- Each fact id of `evidence`, `ignored` and `skipped` is the id of a fact of the report.

The entry `@mark1russell7/netdiag-cli/report` has the report functions only. It starts no probe, so a page can read a report with it.

## The traces

Each run of `netdiag` is one span of a trace, with the service name `netdiag` and the version of the package. The check operates in that span.

- With no value in `OTEL_EXPORTER_OTLP_ENDPOINT`, no span leaves the computer, and the program loads no exporter.
- With a value, the program sends the spans to that OpenTelemetry collector over OTLP before it ends.
- The span has the exit code in the attribute `process.exit.code`. An exit code that is not 0 gives the status `error`.
- The span has no argument of the command. A target can be the name of a private host.

```text
$ OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 netdiag check shop.example.com
```

## The API

The pure parts of the command are also exports. A program can use them with its own probes.

| Export | What it does |
| --- | --- |
| `planCheck(options, system)` | It gives the plan of a check with the grants of its scope, or each problem of the options. |
| `reportOf(plan, steps)` | It gives the report of the steps of a visit. |
| `formatReport(report)` | It gives the lines of the text output. |
| `ownerText(owner, origin)` | It gives the text of the owner of a hop: the network, its holder, its country and its origin AS. |
| `originAsText(owner, origin)`, `hopText(owner, origin)` | They give the origin AS of a hop from the two sources, and the text of a hop with or without an owner. |
| `originText(origin)`, `originLines(origin)` | They give the sentence and the lines of the start of a loss, from an item of `lossOrigins`. |
| `hopsText(hops)`, `networkName(network)` | They give the text of some hops of a path and the short name of a network. |
| `readCheckReport(value)` | It reads a JSON report and gives the report, or at most 20 problems. |
| `nextSteps(diagnosis, plan, addressed)` | It gives the next steps, from the largest gain. |
| `check(options, deps)` | It plans a check, starts the visit with the given clock and tool host, and gives the report. |
| `rdapPort(pace, transport)` | It gives the port of the lookups of the owners over `send` of `polite-crawler/api`. |
| `systemRdap(version)` | It gives the port of this computer, with the `fetch` of Node.js and the pace of `polite-crawler`. |
| `createNetdiagCli(options)` | It makes the command line with a given check, output and terminal. |

## License

MIT
