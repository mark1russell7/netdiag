import { fakeClock } from "@mark1russell7/algebra/clock";
import { fakeToolHost, type FakeOutput, type FakeRule } from "@netdiag/fixtures";
import { describe, expect, it } from "vitest";
import { WIFI_LINK, createRunner, scopeOf, type Fact, type WifiLink } from "../index.ts";
import { readWifi, wifiChannelOf, wifiProbe, type ToolRaw, type ToolRunOptions, type WifiInput, type WifiRaw } from "./index.ts";

// The samples follow the output of iw 6.9, of netsh on Windows 10 and Windows 11, and of system_profiler on macOS 14. The
// MAC addresses are local addresses (02:...), and the GUID is zero.

const IW_DEV = `phy#0
\tInterface wlan0
\t\tifindex 3
\t\twdev 0x1
\t\taddr 02:00:00:00:00:01
\t\tssid lab-net
\t\ttype managed
\t\tchannel 36 (5180 MHz), width: 80 MHz, center1: 5210 MHz
\t\ttxpower 22.00 dBm
\tUnnamed/non-netdev interface
\t\twdev 0x2
\t\taddr 02:00:00:00:00:02
\t\ttype P2P-device
phy#1
\tInterface wlan1
\t\tifindex 4
\t\twdev 0x100000001
\t\taddr 02:00:00:00:00:03
\t\ttype managed
\t\ttxpower 0.00 dBm
\tInterface ap0
\t\tifindex 5
\t\taddr 02:00:00:00:00:04
\t\ttype AP
\t\tchannel 6 (2437 MHz), width: 20 MHz (no HT), center1: 2437 MHz
`;

const IW_LINK = `Connected to 02:00:00:00:00:AA (on wlan0)
\tSSID: lab-net
\tfreq: 5180.0
\tRX: 123456 bytes (789 packets)
\tTX: 23456 bytes (123 packets)
\tsignal: -52 [-54, -55] dBm
\trx bitrate: 866.7 MBit/s VHT-MCS 9 80MHz short GI VHT-NSS 2
\ttx bitrate: 650.0 MBit/s VHT-MCS 7 80MHz short GI VHT-NSS 2

\tbss flags:\tshort-slot-time
\tdtim period:\t2
\tbeacon int:\t100
`;

const IW_SURVEY = `Survey data from wlan0
\tfrequency:\t\t\t5180 MHz [in use]
\tnoise:\t\t\t\t-92 dBm
\tchannel active time:\t\t1234 ms
\tchannel busy time:\t\t56 ms
Survey data from wlan0
\tfrequency:\t\t\t5200 MHz
\tnoise:\t\t\t\t-95 dBm
`;

const NETSH_11 = `
There is 1 interface on the system:

    Name                   : Wi-Fi
    Description            : Wireless network adapter
    GUID                   : 00000000-0000-0000-0000-000000000000
    Physical address       : 02:00:00:00:00:01
    Interface type         : Primary
    State                  : connected
    SSID                   : lab-net
    AP BSSID               : 02:00:00:00:00:aa
    Band                   : 5 GHz
    Channel                : 36
    Connected Akm-cipher   : [ akm = 00-0f-ac:02, cipher = 00-0f-ac:04 ]
    Network type           : Infrastructure
    Radio type             : 802.11ax
    Authentication         : WPA2-Personal
    Cipher                 : CCMP
    Connection mode        : Auto Connect
    Receive rate (Mbps)    : 1201
    Transmit rate (Mbps)   : 960.8
    Signal                 : 88%
    Rssi                   : -52
    Profile                : lab-net

    Hosted network status  : Not available
`;

const NETSH_10 = `
There are 2 interfaces on the system:

    Name                   : Wi-Fi
    Description            : Wireless network adapter
    GUID                   : 00000000-0000-0000-0000-000000000000
    Physical address       : 02:00:00:00:00:01
    State                  : connected
    SSID                   : lab-net
    BSSID                  : 2:0:0:0:0:bb
    Network type           : Infrastructure
    Radio type             : 802.11n
    Authentication         : WPA2-Personal
    Cipher                 : CCMP
    Connection mode        : Auto Connect
    Channel                : 6
    Receive rate (Mbps)    : 144.4
    Transmit rate (Mbps)   : 144.4
    Signal                 : 30%
    Profile                : lab-net

    Name                   : Wi-Fi 2
    Description            : USB wireless adapter
    GUID                   : 00000000-0000-0000-0000-000000000000
    Physical address       : 02:00:00:00:00:05
    State                  : disconnected
    Radio status           : Hardware On
                             Software Off

    Hosted network status  : Not available
`;

function profilerReport(interfaces: readonly unknown[]): string {
  return JSON.stringify({ SPAirPortDataType: [{ spairport_airport_interfaces: interfaces, spairport_software_information: { spairport_corewlan_version: "16.0" } }] }, null, 2);
}

const PROFILER = profilerReport([
  {
    _name: "en0",
    spairport_current_network_information: {
      _name: "lab-net",
      spairport_network_channel: "149 (5GHz, 80MHz)",
      spairport_network_country_code: "US",
      spairport_network_mcs: 9,
      spairport_network_phymode: "802.11ac",
      spairport_network_rate: 866,
      spairport_network_type: "spairport_network_type_station",
      spairport_signal_noise: "-52 dBm / -94 dBm",
    },
    spairport_status_information: "spairport_status_connected",
    spairport_wireless_card_type: "Wi-Fi (0x14E4, 0x4387)",
  },
  { _name: "awdl0", spairport_supported_channels: [6, 44, 149] },
]);

function ok(stdout: string): FakeOutput {
  return { exitCode: 0, stdout, stderr: "" };
}

function raw(command: string, args: readonly string[], output: FakeOutput, platform = "linux"): ToolRaw {
  return { platform, command, args, start: 0, end: 1, ...output };
}

function iwRaw(link = IW_LINK, survey: FakeOutput = ok(IW_SURVEY)): WifiRaw {
  return {
    platform: "linux",
    runs: [
      raw("iw", ["dev"], ok(IW_DEV)),
      raw("iw", ["dev", "wlan0", "link"], ok(link)),
      raw("iw", ["dev", "wlan0", "survey", "dump"], survey),
      raw("iw", ["dev", "wlan1", "link"], ok("Not connected.\n")),
      raw("iw", ["dev", "wlan1", "survey", "dump"], { exitCode: 161, stdout: "", stderr: "command failed: Operation not supported (-95)\n" }),
    ],
  };
}

function one(platform: string, command: string, output: FakeOutput): WifiRaw {
  return { platform, runs: [raw(command, [], output, platform)] };
}

/** This function reads the raw output, and holds that each link passes the check of the kind `wifi.link`. */
function read(value: WifiRaw, input: WifiInput = {}): WifiLink[] {
  const links = readWifi(value, input);
  for (const link of links) expect(WIFI_LINK.check(link), JSON.stringify(link)).toBe(true);
  return links;
}

describe("wifiChannelOf", () => {
  it("gives the channel and the band of each band of IEEE 802.11", () => {
    expect([2412, 2437, 2472, 2484].map(wifiChannelOf)).toEqual([
      { channel: 1, band: "2.4" },
      { channel: 6, band: "2.4" },
      { channel: 13, band: "2.4" },
      { channel: 14, band: "2.4" },
    ]);
    expect([5180, 5500, 5825].map(wifiChannelOf)).toEqual([
      { channel: 36, band: "5" },
      { channel: 100, band: "5" },
      { channel: 165, band: "5" },
    ]);
    expect([5935, 5955, 6115, 7115].map(wifiChannelOf)).toEqual([
      { channel: 2, band: "6" },
      { channel: 1, band: "6" },
      { channel: 33, band: "6" },
      { channel: 233, band: "6" },
    ]);
  });

  it("gives no channel for a frequency that is not a Wi-Fi channel", () => {
    expect([2400, 2413, 5181, 5900, 7200, Number.NaN].map(wifiChannelOf)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("readWifi on Linux", () => {
  it("reads the link and the noise of each managed interface", () => {
    expect(read(iwRaw())).toEqual([
      {
        interface: "wlan0",
        state: "connected",
        ssid: "lab-net",
        bssid: "02:00:00:00:00:aa",
        signalDbm: -52,
        noiseDbm: -92,
        channel: 36,
        band: "5",
        widthMhz: 80,
        txMbps: 650,
        rxMbps: 866.7,
        standard: "802.11ac",
      },
      { interface: "wlan1", state: "disconnected" },
    ]);
  });

  it("keeps the type of an interface when a P2P device follows it", () => {
    const value = iwRaw();
    expect(read(value).map((link) => link.interface)).toEqual(["wlan0", "wlan1"]);
  });

  it("reads an old freq with no decimals, and gives no noise when the survey fails", () => {
    const old = IW_LINK.replace("freq: 5180.0", "freq: 5180").replace("signal: -52 [-54, -55] dBm", "signal: -61 dBm");
    const [link] = read(iwRaw(old, { exitCode: 161, stdout: "", stderr: "command failed\n" }));
    expect(link).toMatchObject({ signalDbm: -61, channel: 36, band: "5" });
    expect(link?.noiseDbm).toBeUndefined();
  });

  it("gives only the interface of the input", () => {
    expect(read(iwRaw(), { interface: "wlan1" })).toEqual([{ interface: "wlan1", state: "disconnected" }]);
  });

  it("throws for iw that failed, and for a link that it cannot read", () => {
    expect(() => readWifi({ platform: "linux", runs: [raw("iw", ["dev"], { exitCode: 1, stdout: "", stderr: "nl80211 not found.\n" })] })).toThrow(/nl80211 not found/);
    expect(() => readWifi({ platform: "linux", runs: [raw("iw", ["dev"], { exitCode: -1, stdout: "", stderr: "", error: "spawn iw ENOENT" })] })).toThrow(/did not start/);
    expect(() => readWifi(iwRaw("Some new format\n"))).toThrow(/cannot read the output of iw dev wlan0 link/);
    expect(() => readWifi({ platform: "linux", runs: [] })).toThrow(/no output of iw dev/);
  });
});

describe("readWifi on Windows", () => {
  it("reads the level in dBm of Windows 11", () => {
    expect(read(one("win32", "netsh", ok(NETSH_11)))).toEqual([
      {
        interface: "Wi-Fi",
        state: "connected",
        ssid: "lab-net",
        bssid: "02:00:00:00:00:aa",
        signalDbm: -52,
        quality: 88,
        channel: 36,
        band: "5",
        txMbps: 960.8,
        rxMbps: 1201,
        standard: "802.11ax",
      },
    ]);
  });

  it("reads the quality of Windows 10, a short MAC address, and a radio that is off", () => {
    expect(read(one("win32", "netsh", ok(NETSH_10)))).toEqual([
      {
        interface: "Wi-Fi",
        state: "connected",
        ssid: "lab-net",
        bssid: "02:00:00:00:00:bb",
        quality: 30,
        channel: 6,
        txMbps: 144.4,
        rxMbps: 144.4,
        standard: "802.11n",
      },
      { interface: "Wi-Fi 2", state: "off" },
    ]);
  });

  it("gives no link with no Wi-Fi interface, and throws with the step for the location permission", () => {
    expect(read(one("win32", "netsh", { exitCode: 1, stdout: "There is no wireless interface on the system.\n", stderr: "" }))).toEqual([]);
    expect(read(one("win32", "netsh", { exitCode: 1, stdout: "The Wireless AutoConfig Service (wlansvc) is not running.\n", stderr: "" }))).toEqual([]);
    const location = "Network shell commands need location permission to access WLAN information. Turn on Location services on the Location page in Privacy & security settings.\n";
    expect(() => readWifi(one("win32", "netsh", { exitCode: 1, stdout: location, stderr: "" }))).toThrow(/location services/);
    expect(() => readWifi(one("win32", "netsh", ok("Es gibt 1 Schnittstelle auf dem System:\n")))).toThrow(/only English output/);
  });
});

describe("readWifi on macOS", () => {
  it("reads the report of system_profiler, and skips the interfaces with no status", () => {
    expect(read(one("darwin", "system_profiler", ok(PROFILER)))).toEqual([
      {
        interface: "en0",
        state: "connected",
        ssid: "lab-net",
        signalDbm: -52,
        noiseDbm: -94,
        channel: 149,
        band: "5",
        widthMhz: 80,
        txMbps: 866,
        standard: "802.11ac",
      },
    ]);
  });

  it("hides a redacted name of the network, and reads a radio that is off and a channel of 2.4 GHz", () => {
    const report = profilerReport([
      {
        _name: "en0",
        spairport_current_network_information: { _name: "<redacted>", spairport_network_channel: "6 (2GHz, 20MHz)", spairport_signal_noise: "-80 dBm / -96 dBm" },
        spairport_status_information: "spairport_status_connected",
      },
      { _name: "en1", spairport_status_information: "spairport_status_off" },
    ]);
    expect(read(one("darwin", "system_profiler", ok(report)))).toEqual([
      { interface: "en0", state: "connected", signalDbm: -80, noiseDbm: -96, channel: 6, band: "2.4", widthMhz: 20 },
      { interface: "en1", state: "off" },
    ]);
  });

  it("throws for a report that is not JSON", () => {
    expect(() => readWifi(one("darwin", "system_profiler", ok("not json")))).toThrow(/JSON report of system_profiler/);
  });
});

describe("readWifi on long output", () => {
  // The two inputs that CodeQL found for the old regular expressions of netsh and system_profiler. Their time was
  // quadratic in the length of the line, so these tests did not end in the time limit of the test.
  it("reads a long line of netsh in linear time", () => {
    const line = `\t${"\t\t".repeat(50_000)}x\n`;
    expect(() => readWifi(one("win32", "netsh", ok(line)))).toThrow(/only English output/);
  });

  it("reads a long signal text of system_profiler in linear time", () => {
    const report = profilerReport([
      {
        _name: "en0",
        spairport_current_network_information: { _name: "lab-net", spairport_signal_noise: "9".repeat(100_000) },
        spairport_status_information: "spairport_status_connected",
      },
    ]);
    expect(read(one("darwin", "system_profiler", ok(report)))).toEqual([{ interface: "en0", state: "connected", ssid: "lab-net" }]);
  });
});

describe("readWifi on other systems", () => {
  it("throws for a system with no adapter", () => {
    expect(() => readWifi({ platform: "freebsd", runs: [] })).toThrow(/freebsd/);
  });
});

/** The probe sends no packet, so any scope lets it run. */
function scopeValue() {
  const scope = scopeOf([{ kind: "range", cidr: "192.0.2.0/24", basis: "owned" }]);
  if (scope.tag === "err") throw new Error(scope.error.join(" "));
  return scope.value;
}

describe("the probe wifi.link", () => {
  const scope = { value: scopeValue() };

  it("runs iw for each managed interface only, with no shell, and gives one fact for each interface", async () => {
    const clock = fakeClock(1000);
    const rules: FakeRule[] = [
      [(args) => args[0] === "--version", ok("iw version 6.9\n")],
      [(args) => args.length === 1 && args[0] === "dev", ok(IW_DEV)],
      [(args) => args[1] === "wlan0" && args[2] === "link", ok(IW_LINK)],
      [(args) => args[1] === "wlan0" && args[2] === "survey", ok(IW_SURVEY)],
      [(args) => args[1] === "wlan1" && args[2] === "link", ok("Not connected.\n")],
      [(args) => args[1] === "wlan1" && args[2] === "survey", { exitCode: 161, stdout: "", stderr: "command failed\n" }],
    ];
    const host = fakeToolHost<ToolRunOptions>("linux", rules, async () => {
      await clock.advance(10);
    });
    const outcome = await createRunner({ scope: scope.value, clock }).run(wifiProbe(host), {});
    if (outcome.status !== "done") throw new Error(JSON.stringify(outcome));
    const facts = outcome.facts as Fact<WifiLink>[];
    expect(facts.map((fact) => [fact.kind, fact.layer, fact.subject.host, fact.value.interface, fact.value.state])).toEqual([
      ["wifi.link", "wifi", "localhost", "wlan0", "connected"],
      ["wifi.link", "wifi", "localhost", "wlan1", "disconnected"],
    ]);
    expect(facts[0]?.source).toMatchObject({ probe: "wifi.link", tool: "iw" });
    expect(host.calls.map((call) => [call.command, ...call.args].join(" "))).toEqual([
      "iw --version",
      "iw dev",
      "iw dev wlan0 link",
      "iw dev wlan0 survey dump",
      "iw dev wlan1 link",
      "iw dev wlan1 survey dump",
    ]);
    expect(host.calls.every((call) => call.options.env?.["LC_ALL"] === "C")).toBe(true);
  });

  it("runs iw only for the interface of the input", async () => {
    const clock = fakeClock();
    const host = fakeToolHost<ToolRunOptions>("linux", [
      [(args) => args[0] === "--version", ok("iw version 6.9\n")],
      [(args) => args.length === 1, ok(IW_DEV)],
      [() => true, ok("Not connected.\n")],
    ]);
    const outcome = await createRunner({ scope: scope.value, clock }).run(wifiProbe(host), { interface: "wlan1" });
    expect(outcome).toMatchObject({ status: "done" });
    expect(host.calls.map((call) => call.args.join(" "))).toEqual(["--version", "dev", "dev wlan1 link", "dev wlan1 survey dump"]);
  });

  it("runs one command on Windows and on macOS", async () => {
    const clock = fakeClock();
    const windows = fakeToolHost<ToolRunOptions>("win32", [
      [(args) => args[1] === "/?", ok("Commands in this context:\n")],
      [() => true, ok(NETSH_11)],
    ]);
    const done = await createRunner({ scope: scope.value, clock }).run(wifiProbe(windows), {});
    expect(done).toMatchObject({ status: "done", facts: [{ value: { interface: "Wi-Fi", signalDbm: -52 } }] });
    expect(windows.calls.map((call) => [call.command, ...call.args].join(" "))).toEqual(["netsh wlan /?", "netsh wlan show interfaces"]);
    const mac = fakeToolHost<ToolRunOptions>("darwin", [
      [(args) => args[0] === "-listDataTypes", ok("Available Datatypes:\nSPAirPortDataType\nSPUSBDataType\n")],
      [() => true, ok(PROFILER)],
    ]);
    const report = await createRunner({ scope: scope.value, clock }).run(wifiProbe(mac), {});
    expect(report).toMatchObject({ status: "done", facts: [{ value: { interface: "en0", noiseDbm: -94 } }] });
    expect(mac.calls.map((call) => call.args.join(" "))).toEqual(["-listDataTypes", "-json SPAirPortDataType"]);
  });

  it("tells the version of iw, and the reason when a tool is not available", async () => {
    const context = { clock: fakeClock(), signal: new AbortController().signal };
    expect(await wifiProbe(fakeToolHost("linux", [[() => true, ok("iw version 6.9\n")]])).available(context)).toEqual({ available: true, version: "6.9" });
    const noAirport = fakeToolHost("darwin", [[() => true, ok("Available Datatypes:\nSPUSBDataType\n")]]);
    expect(await wifiProbe(noAirport).available(context)).toMatchObject({ available: false, reason: expect.stringContaining("SPAirPortDataType") });
    const noWlan = fakeToolHost("win32", [[() => true, { exitCode: 1, stdout: "The following command was not found: wlan /?.\n", stderr: "" }]]);
    expect(await wifiProbe(noWlan).available(context)).toMatchObject({ available: false, reason: expect.stringContaining("wlan") });
    const other = fakeToolHost("freebsd", []);
    expect(await wifiProbe(other).available(context)).toMatchObject({ available: false, reason: expect.stringContaining("freebsd") });
    expect(other.calls).toEqual([]);
  });
});
