# @netdiag/lab

The loopback lab of netdiag. Each case makes one network fault with real servers. The lab diagnoses each case and scores the diagnosis against the true fault. This package is private.

## The world of a case

| Host | Address in CI | What it does |
| --- | --- | --- |
| Resolver | `203.0.113.53` | It answers from the zone of the case, keeps silent, answers `SERVFAIL`, or is absent. |
| Target | `203.0.113.10` | `www.shop-lab.net` on HTTPS. The case can close its port, change its certificate, slow it or make it fail. |
| Reference | `203.0.113.20` | `www.ref-lab.org` on HTTPS, a second site for the comparison. |
| Captive portal | `192.168.250.80` | It gets each name in the portal case, with a self-signed certificate. |

- The range `203.0.113.0/24` is a documentation range. The readers see it as public, so the lab hosts stand for hosts on the internet.
- The probes count the lab root as a public root (the option `publicRoots`). The root of the TLS proxy is a root that the user trusts (the option `roots`).
- `netem` adds 10 ms to each packet on `lo` in CI. Thus the ratios of the times are the ratios of a real path.

## The signs of a case

Each case has signs: the values of the evidence that its fault causes. A result with no sign did not make the fault. It gives no read, not a record. The command then ends with the exit code 2.

## How to start it

In CI, the workflow `lab.yml` adds the addresses and the delay. Then it starts 5 rounds:

```sh
node packages/lab/src/main.ts --hosts ci --rounds 5 --out lab-out
```

On a computer with no set-up, `--hosts local` uses addresses of `127.0.0.0/8`. The readers see these addresses as private, so a local lab examines the mechanics of the lab, not its accuracy.

The command writes `runs.ndjson`, `records.ndjson`, `score.json` and `summary.md`. With `--bars <file>`, it also writes `gate.json`, and a failed gate gives the exit code 1.
