import type { FakeClock } from "@mark1russell7/algebra/clock";
import type { ToolHost, ToolOutput } from "@mark1russell7/netdiag/tools";
import type { Family, Fate, SimNetwork } from "./network.ts";

// The tools of the simulated client: the `ping` of iputils and the `iw` of Linux. Each run gives the text that the real
// tool writes for the fate of its packets in the model of `network.ts`. Thus the real adapters of netdiag read it: the
// ping probe, the search for the MTU, and the Wi-Fi probe. A run moves the fake clock by the time of the real tool.

/** The bytes of the IP header and of the ICMP header of an echo request, for each family. */
const ECHO_HEADER: Readonly<Record<Family, number>> = { 4: 28, 6: 48 };

/** The TTL or the hop limit that a host gives to its echo replies. */
const REPLY_TTL = 64;

/** The name of the radio interface of the client. */
export const WIFI_INTERFACE = "wlan0";

/** The name of the cable interface of the client. */
export const WIRED_INTERFACE = "eth0";

const ok = (stdout: string): ToolOutput => ({ exitCode: 0, stdout, stderr: "" });

/** This function gives the value of an option of an argument list, or `undefined`. */
function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

/** One answer to an echo request: its time after the start of the run, and its line of output. */
interface Answer {
  readonly at: number;
  readonly kind: "reply" | "error";
  readonly line: string;
  readonly toStderr?: boolean | undefined;
}

/**
 * This function gives the tool host of the simulated client. It operates as Linux with iputils `ping` and `iw`. Each
 * other command gives exit code 127, as a shell gives for a command that is not installed.
 */
export function simTools(net: SimNetwork, clock: FakeClock): ToolHost {
  return {
    platform: "linux",
    run(command, args) {
      const output = runOf(net, command, args);
      clock.block(output.ms);
      return Promise.resolve(output.result);
    },
  };
}

function runOf(net: SimNetwork, command: string, args: readonly string[]): { readonly ms: number; readonly result: ToolOutput } {
  if (command === "ping") {
    if (args.length === 1 && args[0] === "-V") return { ms: 2, result: ok("ping from iputils 20240117\n") };
    return ping(net, args);
  }
  if (command === "iw") return { ms: 5, result: iw(net, args) };
  return { ms: 1, result: { exitCode: 127, stdout: "", stderr: `${command}: command not found\n` } };
}

/** The fate of one echo request as an answer of iputils, or `undefined` when no answer comes. */
function answerOf(fate: Fate, sentAt: number, seq: number, address: string, payload: number, ttl: number, family: Family, known: { mtu?: number }): Answer | undefined {
  switch (fate.fate) {
    case "arrive":
      return { at: sentAt + fate.ms, kind: "reply", line: `${payload + 8} bytes from ${address}: icmp_seq=${seq} ttl=${ttl} time=${fate.ms.toFixed(fate.ms < 10 ? 2 : 1)} ms` };
    case "lost":
      return undefined;
    case "unreachable": {
      const detail = fate.code === "no-route" ? "Destination unreachable: No route" : fate.code === "net" ? "Destination Net Unreachable" : "Destination Host Unreachable";
      return { at: sentAt + fate.ms, kind: "error", line: `From ${fate.from} icmp_seq=${seq} ${detail}` };
    }
    case "too-big": {
      // The first message sets the MTU of the path in the cache of the kernel. Each later send fails at once on the
      // client, and iputils writes a local error.
      if (known.mtu === fate.mtu) return { at: sentAt + 0.05, kind: "error", line: `ping: local error: message too long, mtu=${fate.mtu}`, toStderr: true };
      known.mtu = fate.mtu;
      const detail = family === 4 ? `Frag needed and DF set (mtu = ${fate.mtu})` : `Packet too big: mtu=${fate.mtu}`;
      return { at: sentAt + fate.ms, kind: "error", line: `From ${fate.from} icmp_seq=${seq} ${detail}` };
    }
    case "reset":
      return undefined;
  }
}

/**
 * The `ping` of iputils with a deadline (`-w`). It sends one request each interval until the deadline, and it stops
 * when the count of replies and errors is complete. Thus a path with loss gets more requests than the count.
 */
function ping(net: SimNetwork, args: readonly string[]): { readonly ms: number; readonly result: ToolOutput } {
  const address = args.at(-1) ?? "";
  const family: Family = address.includes(":") ? 6 : 4;
  const count = Number(option(args, "-c") ?? "4");
  const intervalMs = Number(option(args, "-i") ?? "1") * 1000;
  const deadlineMs = Number(option(args, "-w") ?? "10") * 1000;
  const payload = Number(option(args, "-s") ?? "56");
  const df = option(args, "-M") === "do";
  const local = net.localError(family);
  if (local !== undefined) return { ms: 0.2, result: { exitCode: 2, stdout: "", stderr: `ping: connect: ${local}\n` } };
  const end = net.endOf(address);
  const size = payload + ECHO_HEADER[family];
  const hops = end === undefined ? [] : net.hops(end);
  const ttl = REPLY_TTL - hops.filter((hop) => hop.router !== undefined).length;
  const known: { mtu?: number } = {};
  const answers: (Answer & { readonly seq: number })[] = [];
  const sends: number[] = [];
  for (let sentAt = 0, seq = 1; sentAt < deadlineMs; sentAt += intervalMs, seq++) {
    sends.push(sentAt);
    if (end === undefined) continue;
    const packet = { end, family, kind: "echo", size, df } as const;
    const answer = answerOf(net.roundTrip(packet, { ...packet, df: false }, hops), sentAt, seq, address, payload, ttl, family, known);
    if (answer !== undefined) answers.push({ ...answer, seq });
  }
  answers.sort((a, b) => a.at - b.at);
  const enough = answers[count - 1];
  const stop = enough === undefined ? deadlineMs : Math.min(deadlineMs, enough.at);
  const sent = sends.filter((at) => at <= stop).length;
  const shown = answers.filter((each) => each.at <= stop);
  const replies = shown.filter((each) => each.kind === "reply");
  const errors = shown.length - replies.length;
  const loss = sent === 0 ? 0 : Math.round((100 * (sent - replies.length)) / sent);
  const lines = [`PING ${address} (${address}) ${payload}(${size}) bytes of data.`, ...shown.filter((each) => each.toStderr !== true).map((each) => each.line), "", `--- ${address} ping statistics ---`];
  const lastSend = sends.filter((at) => at <= stop).at(-1) ?? 0;
  lines.push(`${sent} packets transmitted, ${replies.length} received${errors > 0 ? `, +${errors} errors` : ""}, ${loss}% packet loss, time ${Math.round(lastSend)}ms`);
  if (replies.length > 0) {
    const times = replies.map((each) => Number(/time=([\d.]+)/.exec(each.line)?.[1] ?? "0"));
    const mean = times.reduce((sum, each) => sum + each, 0) / times.length;
    const mdev = Math.sqrt(times.reduce((sum, each) => sum + (each - mean) ** 2, 0) / times.length);
    lines.push(`rtt min/avg/max/mdev = ${[Math.min(...times), mean, Math.max(...times), mdev].map((each) => each.toFixed(3)).join("/")} ms`);
  }
  const stderr = shown.filter((each) => each.toStderr === true).map((each) => `${each.line}\n`).join("");
  return { ms: stop, result: { exitCode: replies.length > 0 ? 0 : 1, stdout: `${lines.join("\n")}\n`, stderr } };
}

/** The `iw` of Linux for the commands of the Wi-Fi probe: `--version`, `dev`, `dev <name> link` and `dev <name> survey dump`. */
function iw(net: SimNetwork, args: readonly string[]): ToolOutput {
  if (args[0] === "--version") return ok("iw version 6.9\n");
  const wifi = net.setup.medium === "wifi";
  if (args.length === 1 && args[0] === "dev") {
    if (!wifi) return ok("");
    // An interface that is down has no channel.
    const channel = net.adminDown || net.carrierDown ? "" : "\t\tchannel 44 (5220 MHz), width: 80 MHz, center1: 5210 MHz\n";
    return ok(`phy#0\n\tInterface ${WIFI_INTERFACE}\n\t\tifindex 3\n\t\twdev 0x1\n\t\taddr 02:00:00:00:00:20\n\t\ttype managed\n${channel}\t\ttxpower 22.00 dBm\n`);
  }
  if (!wifi || args[1] !== WIFI_INTERFACE) return { exitCode: 237, stdout: "", stderr: `command failed: No such device (-19)\n` };
  if (args[2] === "link") {
    if (net.adminDown || net.carrierDown) return ok("Not connected.\n");
    const signal = net.signalDbm();
    const rate = signal < -75 ? "29.3 MBit/s VHT-MCS 1 80MHz VHT-NSS 1" : "866.7 MBit/s VHT-MCS 9 80MHz short GI VHT-NSS 2";
    return ok(
      `Connected to 02:00:00:00:00:01 (on ${WIFI_INTERFACE})\n\tSSID: sim-net\n\tfreq: 5220\n\tRX: 1048576 bytes (1024 packets)\n\tTX: 524288 bytes (512 packets)\n\tsignal: ${signal} dBm\n\trx bitrate: ${rate}\n\ttx bitrate: ${rate}\n\tbss flags: short-slot-time\n\tdtim period: 1\n\tbeacon int: 100\n`,
    );
  }
  if (args[2] === "survey" && args[3] === "dump") {
    return ok(`Survey data from ${WIFI_INTERFACE}\n\tfrequency:\t\t\t5200 MHz\nSurvey data from ${WIFI_INTERFACE}\n\tfrequency:\t\t\t5220 MHz [in use]\n\tnoise:\t\t\t\t-95 dBm\n\tchannel active time:\t\t1000 ms\n\tchannel busy time:\t\t120 ms\n`);
  }
  return { exitCode: 1, stdout: "", stderr: "Usage:\tiw [options] command\n" };
}
