# @netdiag/fixtures

The test fixtures of netdiag. The probe tests and the lab use them. This package is private.

## A temporary package

The home of TLS test certificates and of test DNS servers is `@mark1russell7/rigor-testkit`, in its entries `/tls` and `/dns`. These entries do not exist yet. Thus this package keeps the only copy at this time.

When `rigor-testkit` publishes `/tls` and `/dns`, the tests of netdiag use them, and this package goes away. Do not add other fixtures here.

| Function | What it gives |
| --- | --- |
| `startDnsServer({ zone, host, port })` | A DNS server on UDP. The zone is a table of names or a function. A name gets `A`, `AAAA` or `TXT` records, a response code or no answer. |
| `authority(commonName)` | A root of trust. Its `issue(names, validity)` gives server certificates. An IP address goes in the IP field. |
| `selfSigned(names)` | A self-signed server certificate. |
| `expiredValidity()` | The times of a certificate that expired one day before the call. |
| `listen(server, host, port)` | A server that listens, with a `close` that also ends each open connection. |
