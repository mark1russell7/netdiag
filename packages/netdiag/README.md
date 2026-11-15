# @mark1russell7/netdiag

This package has the core model of netdiag. It has the typed facts at each layer of the stack, the contract of a probe and the scope rule. It also has the catalog of faults and the probability model.

**State: ND-1, ND-2, ND-4, and the lab score and the loopback lab of ND-7 of the [roadmap](../../docs/ROADMAP.md).** The kernel lab and the bars of the gate come next.

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

## Probes

A probe is an adapter. It tells if it is available, it does its work, and it parses its raw output into observations.

- `peers(input)` gives each host that the probe sends packets to. A passive probe gives no peers.
- `run(input, context)` does the effects and gives the raw output.
- `parse(raw, input)` is a pure function. A record of a raw output thus gives the same facts again.

A network failure is a fact, not an error. For example, a TCP connect that times out gives the outcome `timeout`.

## The scope rule

An active probe sends packets only to a peer that the user owns or names. The runner examines each peer before the probe starts.

| Basis | Why the target is in the scope |
| --- | --- |
| `named` | The user named the target for this diagnosis. |
| `owned` | The user declares that the user owns the network or the host. |
| `configured` | The configuration of the computer names it, for example the gateway or the DNS resolver. |
| `resolved` | A DNS answer for a granted name gave this address. |

The scope also limits the number of ports of each host. The default limit is 8. Thus netdiag does no port scan.

## Native probes

The native probes use only the `node:` modules. They need no outside tool.

| Probe | Id | Facts |
| --- | --- | --- |
| `DNS_PROBE` | `dns.query` | `dns.answer`: the outcome, the addresses and the lowest TTL of one query for `A` or `AAAA` records. |
| `tcpProbe()` | `tcp.connect` | `tcp.connect`: the outcome and the time of one connect. |
| `tlsProbe()` | `tls.handshake` | `tcp.connect` and `tls.handshake`: the time of the handshake, the version, the cipher, ALPN and the certificate. |
| `httpProbe()` | `http.request` | `tcp.connect`, `tls.handshake` for `https`, and `http.response`: the status, some fields of the head and the time to the first byte. |

- A probe connects only to an IP address. The DNS probe gives the addresses of a name first. Thus the runner examines each address against the scope.
- The peer of the DNS probe is the resolver, not the name.
- A time limit or a stop of the signal closes the socket. The probe then gives the outcome `timeout`, or the runner gives `aborted`.
- The TLS probe does not refuse a certificate that is not valid. It records the problem, for example `expired`, `name` or `untrusted`.
- The trust tells the root of the chain. `public` is a root of Node.js. `private` is a different root, for example the root of a proxy that examines TLS.
- The option `roots` adds roots that the user trusts, for example the root of a company. Their trust is `private`.
- The option `publicRoots` adds roots with the trust `public`. A lab gives its own root here, so its servers stand for servers on the internet.
- The HTTP probe follows no redirect. It reads the body up to 64 KiB.
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

## Diagnosis

The entry `@mark1russell7/netdiag/diagnosis` has the probability model. It imports no `node:` module, so a browser can also use it.

- A feature is a discrete observation. For example, `tcp.connect` has the values `connected`, `refused`, `timeout`, `unreachable` and `reset`.
- Each feature has a healthy distribution: the probability of each value when there is no fault.
- A fault names a part of the network and the feature values that it predicts. The other features keep their healthy distributions.
- The hypotheses are `none` (no fault), each fault of the catalog, and `unknown` (a cause that the catalog does not have).
- The hypothesis `unknown` gives the same probability to each value. Thus it wins when no fault of the catalog explains the observations.

| Function | What it gives |
| --- | --- |
| `diagnose(catalog, evidence)` | The probability of each hypothesis, from the most probable. The model is naive Bayes with logarithms. |
| `explain(catalog, evidence, id)` | The weight of each observation for a cause: the `log10` of its likelihood ratio against `none`. |
| `predictive(catalog, diagnosis, feature, primary)` | The probability of each value of a feature before a probe observes it. The choice of the next probe (ND-5) uses it. |

Evidence with `primary: false` comes from a reference host, for example a second public server. A fault with the reach `target` does not change the reference host. A fault with the reach `shared` changes both hosts. Thus a slow TLS handshake on both hosts points to a TLS proxy. A slow handshake on the target only points to a slow server.

The standard catalog `STANDARD_CATALOG` has 15 features and 20 faults. The rules of practice give its first likelihoods, and each hypothesis has the same prior. The lab runs (ND-7) then fit these numbers.

```ts
import { STANDARD_CATALOG, diagnose } from "@mark1russell7/netdiag/diagnosis";

const result = diagnose(STANDARD_CATALOG, [
  { feature: "icmp.reply", value: "none", primary: true },
  { feature: "tcp.connect", value: "connected", primary: true },
]);
// result.causes[0].id is "filter.icmp": a filter blocks ICMP, and the host is up.
```

## Readers

`readEvidence(facts, options)` changes the facts of the native probes into evidence for the model. Each value that it gives is a value of a feature of `STANDARD_CATALOG`.

| Feature | The source of the value |
| --- | --- |
| `dns.answer` | The outcome of each DNS query. One answer `ok` for a name and a resolver decides. `nodata` gives `ok`, because the name exists. |
| `dns.address` | The addresses of a public name. One private address decides. A local name, for example `nas.local`, gives no value. |
| `ip.family` | The TCP connects to the IPv4 and the IPv6 addresses of one name. |
| `tcp.connect`, `tcp.time` | The outcome and the time of each TCP connect. A time of 900 ms or more tells that the SYN went again. |
| `tls.handshake`, `tls.trust` | The outcome of the handshake and the root of the certificate chain. A chain with no root of the store gives `private`. |
| `tls.ratio` | The time of the handshake divided by the time of the last TCP connect to the same address and port. |
| `http.status`, `http.ttfb` | The class of the status, and the time to the first byte divided by the time of the TCP connect. |

- The reader gives one evidence for each feature, subject and role. When a subject has more facts, the last fact decides.
- A fact that gives no evidence goes in `skipped`, with the reason. For example, the catalog has no value for the TLS outcome `not-tls` yet.
- The option `primary` tells which facts are about the target. The other facts are about a reference host.

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

## The lab score

A lab makes one fault on purpose. Then netdiag must name it. The entry `@mark1russell7/netdiag/diagnosis` has the score of these runs.

| Function | What it gives |
| --- | --- |
| `labRecordOf(catalog, case, truth, diagnosis)` | The record of one run: the true hypothesis, the predicted cause, the rank of the truth and the probability of each cause. |
| `scoreLab(catalog, records)` | The confusion table, the recall of each hypothesis with its Wilson interval, the accuracy and the mean Brier score. |
| `labGate(score, bars)` | A verdict for each hypothesis with a bar: `pass`, `fail` or `no-read`. |

- The recall of a hypothesis is the part of its runs where the diagnosis names it.
- A hypothesis passes when the lower end of its recall interval is its bar or more.
- A hypothesis with no runs gets `no-read`, and the gate does not pass.
- A hypothesis with no bar goes in `unbarred`, for example a fault that no lab can make.

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
