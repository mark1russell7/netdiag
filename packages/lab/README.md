# @netdiag/lab

The labs of netdiag: the simulated world, the loopback lab and the kernel lab. Each case of a lab makes one network fault with real servers. The simulated world makes it in a model. The lab diagnoses each case and scores the diagnosis against the true fault. This package is private.

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
- Each visit reads the link of the computer first, as `netdiag check` does. Without the link, a resolver with no DNS service and a down interface give the same evidence.

### The signs of a case

Each case has signs: the values of the evidence that its fault causes. A result with no sign did not make the fault. It gives no read, not a record. The command then ends with the exit code 2.

A random fault does not show each sign in each visit. For example, a loss of 20 % keeps 19 or 20 of 20 pings in 7 of 100 visits. So the case loop visits a case again when the evidence does not show each sign, 3 times or fewer (`LAB_VISITS`). A visit with a problem of a probe gets no new visit. The field `visits` of each run tells the count, and the summary counts the runs with more than one visit.

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
| `filter.drop` | The harness drops each packet of the target. The client gets no answer, as from a host that is down behind a silent router. Thus the case names `host.down` as `alike`. |
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

## The coverage of the fault classes

The coverage query tells which fault classes of the catalog have a case in which world, on each layer of the lab (ND-17). A gap is not a pass.

- `coverage` of `src/coverage.ts` joins the classes of the catalog with the cases of each world. It imports no `node:` module itself, but its ladder imports the harness.
- `labWorlds` of `src/worlds.ts` gives the worlds of today: the simulated world, the loopback lab, the kernel lab and the where cases. It reads the bars of each world from `bars/`.
- A world is data: its layer, its cases, the bars of its gate, its traits, and the thing that its gate holds. A new world is one more entry.
- The catalog of netdiag gives the layer of each fault class. `STANDARD_CLASS_NEEDS` gives the traits that a world needs for a case of a class. The fault grammar gives them.

The query gives a row for each class. The row has the layer of the class, and a cell for each world. A cell has the ids of the cases of the class, and tells if the world has a bar for it. The query also gives the gaps as data:

| Gap | What it tells |
| --- | --- |
| `noCase` | A class with no case in any world. The gap names the traits that the class needs, and the worlds that have them. |
| `noBar` | A class with a case and no bar in any world. |
| `layers` | A layer of `LAYERS` with no case of a class. |

A case of a class that needs a trait counts only in a world with that trait. For example, a case of `ipv6.broken` needs a world with IPv6. Today only the simulated world has IPv6. The field `problems` tells each case that does not count.

### The ladder: each class on each layer

Each fault class must have a test on each layer E0 to E6 of the lab. The work of ND-17 ends only at zero gaps. The layers come from the table of [the plan S7](https://github.com/mark1russell7/systems/blob/main/docs/S7.md#the-layers). Their ids are `LAYERS` of `@mark1russell7/harness`.

The field `ladder` of the result has one cell for each class and each layer. The simulated world is on E0, and the other worlds of today are on E1. A cell has one of these states:

| State | Mark | What it tells |
| --- | --- | --- |
| `covered` | ✓ | A world of the layer has a case of the class, and a bar above 0 for it. |
| `no-bar` | ◐ | A world of the layer has a case of the class, and no bar above 0. This is a gap. |
| `gap` | ○ | No world of the layer has a case of the class. |
| `no-class` | ◌ | The fault grammar proposes the class, and the catalog does not have it. This is a gap. |
| `impossible` | ⊘ | The class needs a trait that the layer cannot ever have. The cell gives the reason and the source. |

The ladder also has a row for each class that the fault grammar gives and the catalog does not have. The grammar gives the needs of a proposal. For example, `path.leak` needs `routing`. Each row names the options of the grammar that give its class.

### The impossible rule

A cell is impossible only by a query. Nobody marks a cell by hand.

- `LAYER_FACTS` of the entry `@mark1russell7/harness/layers` gives the name, the proofs, the limits, the tools and the state of each layer, from S7. The lab keeps no copy.
- `LAYER_STATE_TEXT` gives the text of each state for the site. The text of `waiting` names no person.
- `LAYER_LIMITS` gives the traits that each layer cannot have. Each limit is an item of the column "What it cannot prove" of S7, with its row as the source.
- A cell is impossible when its class needs a trait of a limit of its layer.
- When nobody verified a limit, the cell stays a gap. For example, Wi-Fi is not impossible on E1 to E3, because `mac80211_hwsim` can possibly make a Wi-Fi link.
- E0 and E6 have no limit. Today one cell is impossible: `link.duplex` on E4, because a VM has no physical NIC.

| Layer | The traits that it cannot have |
| --- | --- |
| E1 | `kernel`, `clock` and `power` |
| E2 | `kernel` and `power` |
| E3 | `kernel` and `forwarding` |
| E4 | `nic` and `zones` |
| E5 | `forwarding` |

### The gate of the coverage

The file `bars/coverage.json` keeps the counts of the ladder: `gaps`, `classGaps`, `proposalGaps`, `cells`, `covered` and `impossible`. Its field `note` tells the reason of the last change.

- A unit test of `src/coverage.test.ts` fails when the query gives other counts. Thus the job `ci / checks` stops a rise of the gaps.
- After a change that closes a gap, write the new counts in the file. Tell the reason in `note`.

### The files of the roadmap and of the site

The part "The coverage of the fault classes" of `docs/ROADMAP.md` is the rendering of the query. It is between two marker lines. The file `packages/site/src/coverage.json` is the ladder for the demo of the site.

```sh
pnpm --filter @netdiag/lab roadmap
pnpm --filter @netdiag/lab roadmap --check
```

- The command writes the ladder, the tables of the fault atlas and the table of the fault grammar, each between its marker lines. It also writes `coverage.json` of the site.
- The site reads the JSON file and does not import the query, because the harness imports `node:` modules.
- With `--check`, it writes nothing. The exit code is then 1 when a file is not current.
- A unit test of `src/coverage.test.ts` fails when a file is not current. Thus the job `ci / checks` holds the files.
- After a change of a case, a bar, the catalog, the atlas or the grammar, start the command. Commit the files with the change.

## The fault atlas

The fault atlas is a list of the faults of real networks, with their sources (ND-17). It is data: `FAULT_ATLAS` of `src/atlas.ts`.

Each entry has these fields:

| Field | What it tells |
| --- | --- |
| `id` and `layer` | The name of the fault, and its layer of `LAYERS`. |
| `hypothesis` | The fault class of the catalog that names the fault, or `null`. |
| `proposal` | For a fault with no class: the class that the atlas proposes for the catalog. |
| `signs` | The signs of the fault that a probe can see. |
| `world` | The world that can make the fault for a case: `loopback`, `kernel`, `containerlab` or `vm`. |
| `term` | The fault as a term of the fault grammar. The term gives the class and the traits that a world needs for a case of the entry. |
| `sources` | An RFC with its number and section, or a public incident report with its address. |

Each source was read before it was cited. The atlas has only the faults with a source that was read. Thus it has no duplex mismatch and no VLAN mismatch today.

### The atlas in the coverage query

Give the atlas to `coverage` with the field `atlas`. The result then has the field `atlas`:

- A row for each entry, with its state: `covered`, `no-bar`, `no-case` or `no-class`.
- An entry with no class is a gap of the catalog. The field `proposals` gives each proposed class with its entries.
- An entry of a class with no case is a gap of the labs. An entry counts only the cases of a world with the traits that its term needs.
- The counts of the states, for each layer and for each world.

The field `problems` also tells the problems of the atlas. Examples are a class that is not in the catalog, an entry with no source and a class of the catalog with no entry. A term that does not give the class of its entry is also a problem.

The section "The fault atlas" of `docs/ROADMAP.md` has the tables of the gaps by layer and by world. The command `pnpm --filter @netdiag/lab roadmap` writes them.

To add a fault, add an entry to `FAULT_ATLAS`, then start the command. A unit test of `src/atlas.test.ts` holds the gap counts of today.

## The fault grammar

The fault grammar gives each fault as a term (ND-17). It is data: `FAULT_GRAMMAR` of `src/grammar.ts`, a space of `@mark1russell7/strategy-space`.

A term has two stages: `fault` and the optional stage `second`. The choice of a stage is an option of the grammar, with its params:

| Part | What it tells |
| --- | --- |
| Option | A layer of `LAYERS` and a mode of `FAULT_MODES`, for example `path/loss`. |
| `place` | The part of the network with the fault, from `FAULT_PLACES`: `host`, `gateway`, `transit` and others. |
| Severity | The numeric params of the option, for example the rate of the loss or the size of the MTU. |
| Kind | The enum params of the option, for example the address family or the kind of a filter. |
| `second` | A second fault. A rule of `PAIR_RULES` gives a class to some pairs. For example, a small MTU and a filter of the ICMP message give `path.mtu`. |

- The rules of an option give the class of a fault. The first rule that matches the values gives the class.
- Each pair of a layer and a mode is an option, an alias of an option, or a reason in `GRAMMAR_REASONS`. `pairDecision` gives it.
- `GRAMMAR_CLASSES` gives each class with its layer, its options and its needs. A class needs each trait that each of its terms needs.
- `termClasses` and `termNeeds` give the classes and the needs of a term. `termProblems` gives the breaks of a term.
- `sampleTerms` gives a seeded sample of terms. `grammarCounts` counts the options, the aliases, the reasons and the terms.
- `grammarProblems` tells the problems of the grammar. A unit test of `src/grammar.test.ts` holds an empty list.

Each class of the catalog and each entry of the atlas is a class of the grammar. A test fails when an atlas term does not give the class of its entry. Thus the atlas checks that the grammar misses no real fault.

The section "The fault grammar" of `docs/ROADMAP.md` has the table of the modes and the layers. The command `pnpm --filter @netdiag/lab roadmap` writes it.

## The simulated world

The simulated world is the layer E0 of the ladder (ND-17). It is a model of a network in memory. Each case is one visit of netdiag on the model.

- `visitSim` of `src/sim/world.ts` starts the real `visitTarget` of netdiag. The tools and the probes of the model replace the real ones.
- `SimNetwork` of `src/sim/network.ts` is the model. It has the hops from the client to each end, the faults of a term at their places, and a seeded random source.
- The tools of `src/sim/tools.ts` give the output of `ping` and `iw`. The real readers of netdiag read that output.
- The probes of `src/sim/probes.ts` give the DNS, TCP, TLS and HTTP outcomes, with the error codes of Node.js and Linux.
- The visit uses `fakeClock` of `@mark1russell7/algebra/clock`. Thus a plan of 1,680 cases takes approximately 3 seconds, and it needs no lab.
- The visit starts no `mtr`. The model of `mtr` is a later step.

### The cases

`simCases` of `src/sim/cases.ts` gives the plan of one seed: 80 cases of each class of `SIM_CLASSES`. With 80 cases and no miss, the lower end of the Wilson interval is 0.954. With 12 cases, it was 0.757, and a class with 70 % hits got no bar.

- `SIM_CLASSES` has each class of the catalog that a fault of the grammar gives, and `none`. No fault gives the class `unknown`.
- For each class, `enumerateSpace` of strategy-space draws terms of the fault grammar. A term of a case has its class as its only class.
- A term that needs Wi-Fi gets a Wi-Fi client. A term that needs IPv6 gets IPv6. The other cases get a seeded medium and a seeded IPv6.
- The terms of `none` have no fault, or one fault that gives no class alone. An example is a small MTU with no filter of ICMP.

The bands of `SIM_BANDS` keep each fault in the range that a visit can detect. Each band tells its reason. For example, a visit sends 20 pings. A loss below 13.9 % in one direction gives no lost ping in 1 of 20 visits. A fault out of its band is a limit of the visit, not a miss of the diagnosis.

### The bars of the simulated world

The file `bars/sim.json` keeps the bars of the simulated world. `labBars` gives them from the scores of the seeds 1 to 5.

```sh
pnpm --filter @netdiag/lab sim [--out <folder>] [--write]
```

- The command prints the hits of each class, the hits of each option at each place, and the bands.
- Without `--write`, the exit code is 1 when `bars/sim.json` does not have the bars of the runs.
- A unit test of `src/sim/sim.test.ts` does the same check. Thus the job `ci / checks` stops a fall of a bar.
- To change the bars, start the command with `--write`. Tell the reason in the pull request.
- With `--out`, the command also writes `summary.md` and the outcome of each case into the folder. Each outcome has the number of its visits.

A class with a bar above 0 is covered on E0. Each class has a bar above 0 today.

A silent visit is a visit where a fault passed each of its draws, for example a proxy that passed each request. The visit has no sign of the fault, so no diagnosis of the visit can name it.

- The world then visits the case again with a new seed, `SIM_VISITS` (10) times or fewer.
- A fault that is silent in each of these visits gives no read.
- The summary gives the silent visits of each class. A unit test holds their count, 20 of 8,800 today.

### What the simulated world found

The simulated world gives each fault at each place of the grammar. The labs give only one place for each class. Thus the simulated world found these weak points of the catalog. Each is a later step of ND-17, with the bars as its measure.

The hits come from 5 seeds of 80 cases, thus 400 visits for each class.

| Class | Hits | The other answers | The cause |
| --- | --- | --- | --- |
| `path.loss` | 98 % | `none`, `resolver.down` | Five visits lost 1 ping of 20, with each other value on time. A healthy path loses 1 ping of 20 in 8 of 100 visits, so one visit cannot tell them apart. One visit lost the `A` query of each name, and the `AAAA` answers hid the timeouts. Two visits lost pings to only one of two hosts. One loss of 58 % made both DNS queries time out, and read as a down resolver. |

Sixteen changes of ND-17 closed weak points. The first two are measures with 12 cases of each class, and the last fourteen with 80:

- A fault can have more than one reach. The diagnosis sums one variant for each reach. `path.loss`, `path.mtu`, `ipv6.broken` and `tls.proxy` have the reaches `shared` and `target`. `tls.proxy` went from 73 % to 100 %.
- When `ip.family` marks a family as broken, the facts of its addresses give only `ip.family`. Before, they also gave `tcp.connect` and `icmp.reply`, so the model counted one failure two times. `ipv6.broken` went from 72 % to 100 %.
- A loss does not slow a TCP connect: each SYN passes at once, or the client sends it again after 1 s. Thus `path.loss` expects `tcp.time` `short` or `retry`, not `long` or `retry`. `path.loss` went from 59 % to 68 %. The kernel lab read 5 of its 70 recorded loss cases as `server.slow`, and with the new rule it reads all 70 correctly.
- The DNS probe sends a query again after a loss, 3 times or fewer. The DNS of the simulated world does the same. `wifi.weak` went from 69 % to 85 %, and `path.loss` from 68 % to 79 %.
- The Wi-Fi probe also gives the list of the Wi-Fi interfaces. With no connected interface, the feature `wifi.state` is `none`, so `wifi.weak` is not the cause. `path.loss` went from 79 % to 88 %. Before, 42 wired cases read as `wifi.weak`, and 0 do so after the change.
- When an interface is down, the computer has no route, so c-ares cannot send the query and gives `ECONNREFUSED`. Thus `interface.down` expects the DNS values `unreachable` and `timeout`. `interface.down` went from 70 % to 100 %.
- Each miss of `path.mtu` was an IPv6 link with an MTU below 1280 bytes. RFC 8200 forbids it, but a tunnel with no fragmentation can make it. Before, the MTU search stopped when 1280 bytes failed. When 1280 bytes fail, the search tries a plain echo request of 104 bytes, and then finds the MTU below 1280. `path.mtu` went from 58 % to 100 %.
- A loss has two degrees, light and heavy. Under a heavy loss, DNS, TCP, TLS and HTTP time out together. Before, the model took each timeout as one more sign against a loss. A heavy loss read as a down resolver or a filter. `path.loss` went from 88 % to 97 %, and `wifi.weak` from 86 % to 98 %. The kernel lab reads all 70 recorded cases of each class correctly.
- A device of the network can give an HTTP status for an HTTPS site only as a TLS proxy that the clients trust. Thus an HTTP error at the gateway or at the provider comes from a proxy, not from the server. The new class `proxy.error` expects a private issuer and an error status. Before, the simulated world labeled these cases `server.error`, and 7 of them read as `tls.proxy`. `server.error` hits 392 of 400, and `proxy.error` hits 394 of 400. The loopback lab has a case of `proxy.error`: a TLS proxy that gives the status 502.
- The simulated world visits a case again after a silent visit. Before, each silent visit was a miss: `server.error` had 8, `proxy.error` 6 and `filter.reset` 4. The three classes went to 100 %, with no change of the model. The other classes did not change.
- A prediction gives the rest of its mass to the other values as the healthy distribution, with the floor for each value. Before, `name.missing` gave `servfail` the same 0.02 as a healthy answer. `resolver.failing` went from 99 % to 100 %. One case of `path.loss` at a near tie (0.57 to 0.43) went to `wifi.weak`.
- The loss to the gateway is the new feature `gateway.loss`. The new reach `upstream` changes each host past the gateway, but not the local features. `path.loss` has the reaches `shared`, `upstream` and `target`, with the shares 1, 1 and 2 of its prior. `wifi.weak` needs a connected Wi-Fi interface. `path.loss` went from 388 to 387 hits, and `wifi.weak` from 392 to 397. Before, 2 wired cases read as `wifi.weak`, and 0 do so after the change.
- A loss does the same to TCP and HTTP at each place where it starts. Thus `wifi.weak` and `path.loss` take the signs of a loss in `tcp.time` and `http.ttfb` from one place. Before, `wifi.weak` expected a slow connect. `path.loss` went from 387 to 393 hits of 400, and `wifi.weak` from 397 to 400.
- The signs of a loss come from the tries of each step. A step with k tries times out with the chance q^k, under the chance q of a loss of one exchange. A connect that sent its SYN again gives no `tls.ratio` and no `http.ttfb` (Karn's rule). Before, a slow first byte after a late connect read as a slow server. `path.loss` went from 393 to 394 hits of 400. On the seeds 6 to 10, which are not in the fit, it went from 390 to 394.
- Each mode of a fault is a degree with one expected value. A down resolver is silent or absent, and each query of a visit shows the same mode. Before, each query paid for the split of the strength between the two values. Thus 4 DNS timeouts with a gateway that answers read as `gateway.down` (0.62). They read as `resolver.down` (0.82) after the change.
- The degrees of a loss are a grid of the chance q of a loss of one exchange, from 0.05 to 0.9. The bins of `path.loss` follow the binomial distribution of 20 pings, with the new bin `most` for less than half of the replies. Before, a light loss gave 1 lost ping of 20 the chance 0.45, but no loss gives it a chance above 0.38.
- With the modes and the grid, `path.loss` went from 394 to 391 hits of 400, and to 392 on the seeds 6 to 10. The other 21 classes stay at 400. Three of the 5 new misses are near ties. In the other two, the evidence fits another cause better. The 3 new misses of the seeds 1 to 5 are all in seed 3, so the bar of `path.loss` went from 0.831 to 0.747. Step 6 sends more probes for these cases.
