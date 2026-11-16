import { readCheckReport, type CheckReport } from "@mark1russell7/netdiag-cli/report";
import { err, ok, type Result } from "@mark1russell7/optional";

// The sample reports of the lab: the report of `netdiag check` for each loopback case. The site shows them. This
// module imports no `node:` module, so a browser can read the samples with it.

/** The format of the file of samples. A change to the shape of `CheckSamples` changes the format. */
export const SAMPLES_FORMAT = "netdiag-samples/1";

/** The report of `netdiag check` in the world of one lab case. */
export interface CheckSample {
  /** The id of the lab case. */
  readonly id: string;
  /** The id of the hypothesis that is true in the world of the case. */
  readonly truth: string;
  /** The fault of the case, for a person. */
  readonly summary: string;
  readonly report: CheckReport;
}

/** The file of samples. `samples-main.ts` writes it. */
export interface CheckSamples {
  readonly format: typeof SAMPLES_FORMAT;
  /** The commit of the run that made the samples. */
  readonly commit: string;
  readonly samples: readonly CheckSample[];
}

function isFields(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isName(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/**
 * This function reads a file of samples and checks it. Each report passes `readCheckReport`, and each id is unique.
 * The result is the same object with the type `CheckSamples`, or the problems of the value.
 */
export function readSamples(value: unknown): Result<CheckSamples, string[]> {
  if (!isFields(value) || value["format"] !== SAMPLES_FORMAT) return err([`The samples do not have the format "${SAMPLES_FORMAT}".`]);
  const samples = value["samples"];
  if (!isName(value["commit"]) || !Array.isArray(samples)) return err(["The samples have no commit or no list of samples."]);
  const problems: string[] = [];
  const ids = new Set<string>();
  samples.forEach((sample: unknown, at) => {
    if (!isFields(sample) || !isName(sample["id"]) || !isName(sample["truth"]) || typeof sample["summary"] !== "string") {
      problems.push(`The sample ${at + 1} has no id, no truth or no summary.`);
      return;
    }
    if (ids.has(sample["id"])) problems.push(`The sample id ${sample["id"]} is not unique.`);
    ids.add(sample["id"]);
    const read = readCheckReport(sample["report"]);
    if (read.tag === "err") problems.push(...read.error.map((problem) => `The report of ${sample["id"]}: ${problem}`));
  });
  return problems.length > 0 ? err(problems) : ok(value as unknown as CheckSamples);
}
