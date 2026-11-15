# @mark1russell7/netdiag

This package has the core model of netdiag. It has the typed facts at each layer of the stack, the contract of a probe and the scope rule.

**State: ND-1 of the [roadmap](../../docs/ROADMAP.md).** The native probes (ND-2) and the probability model (ND-4) come next.

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
