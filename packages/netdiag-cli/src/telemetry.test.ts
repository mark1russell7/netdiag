import { startStubCollector, type StubCollector } from "@mark1russell7/otel-ts/node/testing";
import { captureTelemetry } from "@mark1russell7/rigor-testkit/otel";
import { isSpanContextValid, SpanStatusCode, trace } from "@opentelemetry/api";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace";
import type { Print } from "@procedures/cli-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNetdiagCli } from "./cli.ts";
import { planCheck, type CheckOptions } from "./plan.ts";
import { reportOf, type CheckReport } from "./report.ts";
import { inRunSpan, RUN_SPAN, SERVICE_NAME, startTelemetry } from "./telemetry.ts";

// The traces of the command line, with a fake check. No test sends a packet to a host other than this computer.

const stops: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of stops.splice(0).reverse()) await stop();
  vi.unstubAllEnvs();
});

const quiet: Print = {
  info: () => undefined,
  error: () => undefined,
  success: () => undefined,
  warning: () => undefined,
  table: () => undefined,
  spin: () => ({ stop: () => undefined, succeed: () => undefined, fail: () => undefined, text: "" }),
};

function fakeReport(options: CheckOptions): CheckReport {
  const plan = planCheck(options, { resolvers: ["192.0.2.53"] });
  if (plan.tag === "err") throw new RangeError(plan.error.join("\n"));
  return reportOf(plan.value, []);
}

/** This function runs the command line in the span of a run. The fake check writes the trace id of its active span to `seen`. */
async function runTraced(argv: readonly string[], seen: string[]): Promise<number> {
  const cli = createNetdiagCli({
    version: "9.9.9",
    print: quiet,
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, env: {} },
    check: async (options) => {
      const ids = trace.getActiveSpan()?.spanContext();
      if (ids !== undefined && isSpanContextValid(ids)) seen.push(ids.traceId);
      return fakeReport(options);
    },
  });
  return inRunSpan(() => cli.run(argv));
}

describe("the traces of the command line", () => {
  it("runs the check in the trace of the span of the run, with the resource of the program", async () => {
    const capture = captureTelemetry({ sdk: "external" });
    const telemetry = await startTelemetry({ version: "0.0.0-test", spanProcessors: [new SimpleSpanProcessor({ exporter: capture.spanExporter })], env: {} });
    stops.push(() => telemetry.shutdown());
    const seen: string[] = [];

    const code = await runTraced(["check", "shop.example"], seen);

    expect(code).toBe(0);
    const spans = await capture.spans();
    const run = spans.find((span) => span.name === RUN_SPAN);
    expect(run).toBeDefined();
    expect(run?.parentSpanContext).toBeUndefined();
    expect(run?.attributes["process.exit.code"]).toBe(0);
    expect(run?.status.code).toBe(SpanStatusCode.UNSET);
    expect(run?.resource.attributes["service.name"]).toBe(SERVICE_NAME);
    expect(run?.resource.attributes["service.version"]).toBe("0.0.0-test");
    // The check runs in the trace of the run, and each span of the run is in that trace.
    expect(seen).toEqual([run?.spanContext().traceId]);
    expect(new Set(spans.map((span) => span.spanContext().traceId))).toEqual(new Set(seen));
    // The span has no argument of the command line: a target can be the name of a private host.
    expect(JSON.stringify(spans.map((span) => span.attributes))).not.toContain("shop.example");
  });

  it("gives the span of a run that fails the status error and its exit code", async () => {
    const capture = captureTelemetry({ sdk: "external" });
    const telemetry = await startTelemetry({ version: "0.0.0-test", spanProcessors: [new SimpleSpanProcessor({ exporter: capture.spanExporter })], env: {} });
    stops.push(() => telemetry.shutdown());

    const code = await runTraced(["check", "--port", "0", "shop.example"], []);

    expect(code).not.toBe(0);
    const run = (await capture.spans()).find((span) => span.name === RUN_SPAN);
    expect(run?.attributes["process.exit.code"]).toBe(code);
    expect(run?.status.code).toBe(SpanStatusCode.ERROR);
  });

  it("exports the spans of a run to the endpoint of the variables, and the stop flushes them", async () => {
    const collector: StubCollector = await startStubCollector();
    stops.push(() => collector.close());
    // The OTLP exporter reads its endpoint from process.env. The stub collector reads OTLP/HTTP JSON.
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", collector.endpoint);
    const env = { OTEL_EXPORTER_OTLP_ENDPOINT: collector.endpoint, OTEL_EXPORTER_OTLP_PROTOCOL: "http/json" };
    const telemetry = await startTelemetry({ version: "0.0.0-test", env });

    await runTraced(["check", "shop.example"], []);
    await telemetry.shutdown();

    expect(collector.spansByScope().get(SERVICE_NAME)).toEqual(new Set([RUN_SPAN]));
  });

  it("exports nothing with no endpoint", async () => {
    const collector: StubCollector = await startStubCollector();
    stops.push(() => collector.close());
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", collector.endpoint);
    const telemetry = await startTelemetry({ version: "0.0.0-test", env: {} });

    await runTraced(["check", "shop.example"], []);
    await telemetry.shutdown();

    expect(collector.exports).toBe(0);
  });
});
