// This file is data. The command of the simulated world of the lab writes it with --write, from seeds that its gate does not use.

/**
 * The concentration of the repeats of each feature of `STANDARD_CATALOG`. It is the fit of the Dirichlet-multinomial law to
 * the repeated observations of the held-out seeds of the sim. A feature with no entry has independent repeats.
 */
export const STANDARD_CONCENTRATIONS: Readonly<Record<string, number>> = {
  "path.loss": 0.124,
  "path.mtu": 0.000001,
  "icmp.reply": 0.000001,
  "tcp.connect": 0.000001,
  "tcp.time": 0.136,
  "tls.ratio": 0.0733,
  "tls.trust": 0.000001,
  "tls.root": 0.000001,
  "http.status": 0.106,
  "http.ttfb": 0.0534,
};
