# @netdiag/fixtures

The test fixtures of netdiag. The probe tests and the lab use them. This package is private.

| Function | What it gives |
| --- | --- |
| `startDnsServer({ zone, host, port })` | A DNS server on UDP. The zone is a table of names or a function. A name gets records, a response code or no answer. |
| `authority(commonName)` | A root of trust. Its `issue(names, validity)` gives server certificates. An IP address goes in the IP field. |
| `selfSigned(names)` | A self-signed server certificate. |
| `expiredValidity()` | The times of a certificate that expired one day before the call. |
| `listen(server, host, port)` | A server that listens, with a `close` that also ends each open connection. |
