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

A group of signs (`anyOf`) is for a fault with more than one form. The evidence shows the group when it shows one sign of the group.

### How to start it

In CI, the workflow `lab.yml` adds the addresses and the delay. Then it starts 5 rounds:

```sh
node packages/lab/src/main.ts --hosts ci --rounds 5 --out lab-out
```

On a computer with no set-up, `--hosts local` uses addresses of `127.0.0.0/8`. The readers see these addresses as private, so a local lab examines the mechanics of the lab, not its accuracy.

The command writes `runs.ndjson`, `records.ndjson`, `score.json` and `summary.md`. With `--bars <file>`, it also writes `gate.json`, and a failed gate gives the exit code 1.

### The sample reports of the site

The command `samples-main.ts` starts the world of each loopback case. Then it starts `netdiag check` in the world, as a user does:

```sh
node packages/lab/src/samples-main.ts --hosts ci --commit <sha> --out lab-out/samples.json
```

The file has the format `netdiag-samples/1`: the id, the true fault and the report of each case. `readSamples` of the entry `@netdiag/lab/samples` reads it. The site shows the samples in its demo 4, from `packages/site/src/samples.json`. A case that gives no report gives the exit code 2.

The where cases of the kernel lab give a second file of samples, `packages/site/src/where-samples.json`. The section "The where cases" tells how the job `where` writes it.

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
| `filter.reset` | The target lets each SYN pass, and resets each later segment from the client. The connect or the TLS handshake gets the reset. |
| `gateway.down` | The router drops each packet, and the link of the client stays up. |

The gate lists `ipv6.broken` with no bar, because the networks of the harness have no IPv6. `KERNEL_LATER` in `src/kernel/cases.ts` gives the reason.

### How to start the kernel lab

In CI, the workflow `lab-kernel.yml` starts 5 rounds:

```sh
node packages/lab/src/kernel/main.ts --rounds 5 --out lab-kernel-out
```

The outputs, the option `--bars` and the exit codes are the same as the outputs of the loopback lab.

### The where cases

The where cases examine `lossStart` of netdiag: the part of a path where a loss starts (ND-15). The job `where` of `lab-kernel.yml` starts them in their own worlds.

| Case | Fault | The part that `lossStart` must give |
| --- | --- | --- |
| `loss.last-link` | `netem` drops 30% of the packets of the target. | After the router: the target only. |
| `loss.first-link` | `netem` drops 30% of the packets that the router sends to the client. | The full path, from the first link. |
| `none` | No fault. | No part, because the path has no loss. |

- The agent visits the address of the target, with no reference host and no ping. It starts 60 cycles of `mtr` (`WHERE_CYCLES`).
- The agent also looks up the owner and the origin AS of each hop, as `netdiag check --owners` does.
- A run has a read only when each probe ended and the visit has one report of `mtr` that reached the target.
- With a loss of 30% and 60 cycles, `lossStart` misses the start after the router in approximately 2 of 10000 runs.
- On the first link, it puts a false start after the router in approximately 5 of 1000 runs.
- The recall of a case is the part of its reads with a hit. `whereRecalls` gives the recalls in the form that `labBars` and `labGate` of netdiag read.
- The bars of the cases are in `bars/where.json`. They come from 5 runs in CI, as the bars of the gate do.
- Until a dispatch gives this file, the job `where` has no gate. A file with no bar for a case stops the command.

```sh
node packages/lab/src/kernel/where-main.ts --rounds 5 --out lab-where-out --bars packages/lab/bars/where.json
```

The command writes `where.ndjson`, `score.json`, `samples.json` and `summary.md`, and `gate.json` with `--bars`. The field `score` of `score.json` has the recalls, so `bars-main.ts` reads the file. The exit code is 2 when a run has no read, and 1 when the gate fails. Each other result gives 0.

#### The samples of the where cases

The file `samples.json` has the format `netdiag-samples/1`. It has the report of the first read of each where case.

- `reportOf` of the CLI makes each report from the steps of the visit. `checkPlanOf` gives the plan of the check from the plan of the agent.
- The true fault of the two loss cases is `path.loss`. The true fault of the control is `none`.
- The commit of the file is the head of the pull request, else `GITHUB_SHA`. The option `--commit` sets it.
- The command reads the file with `readSamples`. A file with problems gives the exit code 2.
- The site keeps the file of one CI run as `packages/site/src/where-samples.json`. Copy the file from the artifact `lab-where-<sha>-1` of the run.

#### The lookups that cannot leave the lab

The lookups of the owners and the origins send no packet out of the lab.

- The agent image has no `netdiag-cli`, so the agent has no RDAP client and no TXT client of its own.
- The RDAP port of the agent (`refuseRdap`) refuses each request. The TXT port (`refuseTxt`) refuses each query.
- Each hop of the lab has a private address. Thus each lookup gives the outcome `special`, and the probes do not use the ports.
- The plan grants the hosts of RDAP and the zones of Team Cymru by name, as `planCheck` of the CLI does. `lookupGrants` of netdiag gives the grants to the lab and to the CLI.

## The bars of the gate

The bar of each hypothesis comes from 5 or more runs of one lab in CI. Each run is one job on its own runner.

1. Start the workflow `lab.yml` or `lab-kernel.yml` with the input `runs` set to `[1,2,3,4,5]` and the input `bars` set to `true`.
2. The matrix of the job `lab` starts one job for each run. Each job uploads its outputs as `<lab>-<commit>-<run>`.
3. The job `bars` reads the file `score.json` of each run. `labBars` of netdiag gives the bars.
4. The job writes the table of the bars in the summary of the run, and uploads the file of the bars.

The command of the job `bars`:

```sh
node packages/lab/src/bars-main.ts --out bars-out/kernel.json runs/*
```

- Each argument is the folder of one run, or its file `score.json`.
- A run with a case with no read gives no bars. The exit code is then 2.
- The options `--k` and `--minimum` set the number of standard deviations (2) and the fewest runs (5).
- The option `--title` sets the heading of the table. The job `bars` also gives `where.json` from the runs of the job `where`.

### The bars in the repository

The files `bars/loopback.json` and `bars/kernel.json` keep the bars of the two labs. Each file comes from 5 runs in CI: the runs [43773608651](https://github.com/mark1russell7/netdiag/actions/runs/43773608651) (loopback) and [43773578029](https://github.com/mark1russell7/netdiag/actions/runs/43773578029) (kernel).

- Each lab job passes its file with `--bars`. A recall below its bar fails the job, and thus the pull request.
- The bars hold for 5 rounds. A job with a different number of rounds gets no file, and thus no gate.
- To change the bars, start a new dispatch with `bars` set to `true`. Then commit its files in a pull request.
