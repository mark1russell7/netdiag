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

1. It asks the DNS resolver for the IPv4 and IPv6 addresses of each name.
2. It pings each address, connects to it, does the TLS handshake and sends one HTTP request.
3. It reads the facts into evidence. The catalog of faults gives the probability of each cause.
4. It finds the probe with the largest information gain over the 3 most probable causes. This probe is the next step.

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
| `--json` | Off | It writes the whole report as JSON. |
| `--help` | Off | It shows the options. |
| `--version` | Off | It shows the version. |

The exit code is 0 after a check. It is 1 for an option that is not valid. A fault of the network does not change the exit code.

## The scope rule

netdiag sends packets only to the hosts that you name or own. The check grants only these hosts:

- the target and each reference host;
- the DNS resolver, from `--resolver` or from the computer;
- the gateway, when you give `--gateway`;
- each range of `--grant`;
- each address that the resolver gives for a granted name.

The check sends no packet to another host. A grant with a problem stops the check before the first probe. Thus a typing error cannot make the scope wider.

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

## The API

The pure parts of the command are also exports. A program can use them with its own probes.

| Export | What it does |
| --- | --- |
| `planCheck(options, system)` | It gives the plan of a check with the grants of its scope, or each problem of the options. |
| `reportOf(plan, steps)` | It gives the report of the steps of a visit. |
| `formatReport(report)` | It gives the lines of the text output. |
| `nextSteps(diagnosis, plan, addressed)` | It gives the next steps, from the largest gain. |
| `check(options, deps)` | It plans a check, starts the visit with the given clock and tool host, and gives the report. |
| `createNetdiagCli(options)` | It makes the command line with a given check, output and terminal. |

## License

MIT
