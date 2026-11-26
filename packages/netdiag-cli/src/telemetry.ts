import { startNodeContext, type NodeContext, type NodeContextOptions } from "@mark1russell7/otel-ts/node/context";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";

// The traces of the command line. Each run of `netdiag` registers the context of `@mark1russell7/otel-ts/node/context`,
// with the resource of the program, and runs its command in one span. The check runs in that span, so each span of the
// check is in the trace of the run.
//
// - The spans leave the process only when `OTEL_EXPORTER_OTLP_ENDPOINT` has a value. Then the program loads the exporters of
//   `@mark1russell7/otel-ts/node/export`, and the stop of the context flushes them before the program ends.
// - With no endpoint, the program loads no exporter, and no span leaves the computer.
// - The span has no argument of the command line. A target can be the name of a private host.

/** The name of the service in the resource of each span, and the name of the tracer of the command line. */
export const SERVICE_NAME = "netdiag";

/** The name of the span of a run. */
export const RUN_SPAN = "netdiag";

/** The options of `startTelemetry`. */
export interface TelemetryOptions {
  /** The version of this package: the attribute `service.version` of the resource. */
  readonly version: string;
  /** The span processors. The default exports to the endpoint of the variables, or gives none. A test gives the processor of its capture. */
  readonly spanProcessors?: NodeContextOptions["spanProcessors"];
  /** The environment of the endpoint, of the exporters and of the resource detectors. The default is `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
}

/** This function registers the context of the traces of a run, with the resource of the program. */
export async function startTelemetry(options: TelemetryOptions): Promise<NodeContext> {
  const env = options.env ?? process.env;
  const spanProcessors =
    options.spanProcessors ??
    (env["OTEL_EXPORTER_OTLP_ENDPOINT"] ? (await import("@mark1russell7/otel-ts/node/export")).exportSpanProcessors({ env }) : []);
  return startNodeContext({ serviceName: SERVICE_NAME, resourceAttributes: { "service.version": options.version }, spanProcessors, env });
}

/**
 * This function starts a command in the span of a run, and gives its exit code. The span gets the attribute `process.exit.code`.
 * An exit code that is not 0, or an error, gives the span the status `error`.
 */
export async function inRunSpan(work: () => Promise<number>): Promise<number> {
  const span = trace.getTracer(SERVICE_NAME).startSpan(RUN_SPAN);
  try {
    const code = await context.with(trace.setSpan(context.active(), span), work);
    span.setAttribute("process.exit.code", code);
    if (code !== 0) span.setStatus({ code: SpanStatusCode.ERROR, message: `exit code ${code}` });
    return code;
  } catch (error) {
    span.recordException(error instanceof Error ? error : String(error));
    span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    span.end();
  }
}
