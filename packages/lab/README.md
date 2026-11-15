# @netdiag/lab

The labs of netdiag: the loopback lab and the kernel lab. Each case makes one network fault with real servers. The lab diagnoses each case and scores the diagnosis against the true fault. This package is private.

## The loopback lab

### The world of a case

| Host | Address in CI | What it does |
| --- | --- | --- |
| Resolver | `203.0.113.53` | It answers from the zone of the case, keeps silent, answers `SERVFAIL`, or is absent. |
| Target | `203.0.113.10` | `www.shop-lab.net` on HTTPS. The case can close its port, change its certificate, slow it or make it fail. |
| Reference | `203.0.113.20` | `www.ref-lab.org` on HTTPS, a second site for the comparison. |
| Captive portal | `192.168.250.80` | It gets each name in the portal case, with a self-signed certificate. |

- The range `203.0.113.0/24` is a documentation range. The readers see it as public, so the lab hosts stand for hosts on the internet.
- The probes count the lab root as a public root (the option `publicRoots`). The root of the TLS proxy is a root that the user trusts (the option `roots`).
- `netem` adds 10 ms to each packet on `lo` in CI. Thus the ratios of the times are the ratios of a real path.

### The signs of a case

Each case has signs: the values of the evidence that its fault causes. A result with no sign did not make the fault. It gives no read, not a record. The command then ends with the exit code 2.

### How to start it

In CI, the workflow `lab.yml` adds the addresses and the delay. Then it starts 5 rounds:

```sh
node packages/lab/src/main.ts --hosts ci --rounds 5 --out lab-out
```

On a computer with no set-up, `--hosts local` uses addresses of `127.0.0.0/8`. The readers see these addresses as private, so a local lab examines the mechanics of the lab, not its accuracy.

The command writes `runs.ndjson`, `records.ndjson`, `score.json` and `summary.md`. With `--bars <file>`, it also writes `gate.json`, and a failed gate gives the exit code 1.

## The kernel lab

The kernel lab makes the faults of the path with real kernels in Docker. It uses the harness of `mark1russell7/systems` (`@mark1russell7/harness`). It needs Docker, so only CI starts it.

### The world of a round

Each round starts one world. Each case adds its fault to the world, starts the agent, and removes the fault.

| Host | Image | What it does |
| --- | --- | --- |
| Client | The netdiag image | The agent (`src/kernel/agent.ts`) visits the target and writes one JSON line for each fact. |
| Router `gw` | The router of the harness | It joins the network of the client to the network of the target. Its address on the network of the client is the gateway of the visit. |
| Target | The stock Node image | `www.shop.test` on HTTPS, from `src/kernel/https.ts`. |
| Reference | The netdiag image | `www.ref.test` on HTTPS, a second site for the comparison. |
| Resolver | The netdiag image | It answers the two names from a fixed zone (`src/kernel/resolver.ts`). |

- The netdiag image is `kernel/Dockerfile`: Node 24 on a base pinned by digest, with `ping`, `mtr`, `traceroute` and `ip`.
- The agent probes only the three lab hosts and the gateway. Its scope grants each of these addresses as a `/32` range.
- The visit first reads the link of the client to the gateway. At the end, it pings the gateway.
- The agent starts `ping` through `commandHost` of netdiag and `runCommand` of `@procedures/shell`, with a list of arguments and no shell.

### The cases

| Case | Fault |
| --- | --- |
| `none` | No fault. |
| `filter.drop` | The harness drops each packet of the target. |
| `filter.icmp` | The target ignores each echo request (`net.ipv4.icmp_echo_ignore_all`). |
| `path.loss` | `netem` drops 20% of the packets of the target. |
| `path.mtu` | The router drops each TCP packet above 1200 bytes toward the two servers. |
| `host.down` | The router answers each packet to the target with an ICMP host unreachable. |
| `filter.reset` | The target lets each SYN pass, and resets each later segment from the client. |
| `gateway.down` | The router drops each packet, and the link of the client stays up. |

The gate lists `ipv6.broken` with no bar, because the networks of the harness have no IPv6. `KERNEL_LATER` in `src/kernel/cases.ts` gives the reason.

### How to start the kernel lab

In CI, the workflow `lab-kernel.yml` starts 5 rounds:

```sh
node packages/lab/src/kernel/main.ts --rounds 5 --out lab-kernel-out
```

The outputs, the option `--bars` and the exit codes are the same as the outputs of the loopback lab.
