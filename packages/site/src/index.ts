/**
 * The demos of the home page. Each demo reads its controls, calls the model, and shows the result.
 *
 * @packageDocumentation
 */
import { byId, copyText, h, setupTheme } from "@mark1russell7/site-pages/chrome";
import { examples, verdict } from "@mark1russell7/site-pages/demo";
import { GAIN_RESOLUTION, LAYERS, NONE, UNKNOWN, type Diagnosis, type Evidence } from "@mark1russell7/netdiag/diagnosis";
import { readCheckReport, type CheckReport } from "@mark1russell7/netdiag-cli/report";
import type { LadderCell, LadderRow, LadderState, SiteLadder } from "@netdiag/lab/coverage";
import { readSamples, type CheckSample } from "@netdiag/lab/samples";
import {
  CATALOG,
  FEATURE_NAMES,
  FOUND,
  LAYER_NAMES,
  PROBES,
  SCENARIOS,
  TRUTHS,
  autoSearch,
  diagnoseBoard,
  explainCause,
  factorText,
  featureGroups,
  hiddenTruth,
  hypothesisOf,
  isUsual,
  percent,
  runLab,
  search,
  searchDone,
} from "./model.ts";
import { flowOf, pathsOf, ringsOf, timelineOf, type FlowItem, type PathHop, type PathView, type RingId } from "./report-views.ts";
import coverageJson from "./coverage.json";
import samplesJson from "./samples.json";
import whereSamplesJson from "./where-samples.json";

setupTheme(byId<HTMLButtonElement>("theme"), "theme");

const copy = byId<HTMLButtonElement>("copy");
copy.addEventListener("click", () => {
  void copyText(copy, byId("install").textContent ?? "");
});

/** This function starts `fn` one time, `ms` milliseconds after the last request. */
function later(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

/** This function gives the width of a bar for a probability or a part, from 0 to 1. */
const width = (part: number): string => `${(Math.max(0, Math.min(1, part)) * 100).toFixed(1)}%`;

/** This function gives an observation as text: the feature, the value, and the host when it is the second host. */
function observation(item: Evidence): HTMLElement {
  return h("span", { class: "obs" }, h("code", {}, `${item.feature} = ${item.value}`), item.primary ? null : h("span", { class: "tag" }, "second host"));
}

/** The options of a list of causes. */
interface CauseOptions {
  readonly count: number;
  /** The cause that the list marks as selected. */
  readonly selected?: string | undefined;
  /** With `pick`, each cause is a button. */
  readonly pick?: ((id: string) => void) | undefined;
  /** The true cause, when the demo shows it. */
  readonly truth?: string | undefined;
}

/** This function shows the most probable causes of a diagnosis, each with a bar of its probability. */
function showCauses(list: HTMLElement, diagnosis: Diagnosis, options: CauseOptions): void {
  const top = diagnosis.causes.slice(0, options.count);
  const rest = diagnosis.causes.slice(options.count);
  const restP = rest.reduce((sum, cause) => sum + cause.probability, 0);
  const items = top.map((cause) => {
    const parts = [
      h(
        "span",
        { class: "cause-head" },
        h("code", {}, cause.id),
        cause.id === options.truth ? h("span", { class: "tag truth-tag" }, "the fault") : null,
        h("b", { class: "pct" }, percent(cause.probability)),
      ),
      h("span", { class: "meter", style: `--p: ${width(cause.probability)}` }),
      h("span", { class: "cause-text" }, cause.summary),
    ];
    const pick = options.pick;
    if (pick === undefined) return h("li", { class: "cause" }, h("div", { class: "cause-box" }, parts));
    const button = h("button", { type: "button", class: "cause-box", "aria-pressed": String(cause.id === options.selected) }, parts);
    button.addEventListener("click", () => pick(cause.id));
    return h("li", { class: "cause" }, button);
  });
  if (rest.length > 0) items.push(h("li", { class: "cause rest" }, `${rest.length} other causes: ${percent(restP)} together`));
  list.replaceChildren(...items);
}

// 1. Name the cause

type Host = "target" | "reference";
const board: Record<Host, Record<string, string>> = { target: {}, reference: {} };
let host: Host = "target";
let selected: string | undefined;

const stack = byId("board-stack");
const valueButtons: HTMLButtonElement[] = [];
for (const group of featureGroups()) {
  const rows = group.features.map((feature) => {
    const name = FEATURE_NAMES[feature.id] ?? feature.id;
    const buttons = feature.values.map((value) => {
      const button = h(
        "button",
        { type: "button", class: isUsual(feature.id, value) ? "usual" : "unusual", "aria-pressed": "false", "data-feature": feature.id, "data-value": value },
        value,
      );
      button.addEventListener("click", () => {
        const side = board[host];
        if (side[feature.id] === value) delete side[feature.id];
        else side[feature.id] = value;
        selected = undefined;
        showBoard();
      });
      valueButtons.push(button);
      return button;
    });
    return h(
      "div",
      { class: "feature" },
      h("p", { class: "feature-name", title: feature.summary }, name, " ", h("code", {}, feature.id)),
      h("div", { class: "values", role: "group", "aria-label": name }, buttons),
    );
  });
  stack.append(h("div", { class: "layer" }, h("p", { class: "layer-name" }, LAYER_NAMES[group.layer]), h("div", { class: "layer-features" }, rows)));
}

const hostButtons = [...byId("board-host").querySelectorAll<HTMLButtonElement>("[data-host]")];
for (const button of hostButtons) {
  button.addEventListener("click", () => {
    host = button.dataset["host"] === "reference" ? "reference" : "target";
    showBoard();
  });
}

byId("board-clear").addEventListener("click", () => {
  board.target = {};
  board.reference = {};
  selected = undefined;
  showBoard();
});

/** This function shows the explanation of the selected cause: the factor of each observation. */
function showWhy(diagnosis: Diagnosis, id: string): void {
  const why = byId("board-why");
  const explanation = explainCause(board, diagnosis, id);
  if (explanation === undefined) {
    why.replaceChildren(h("p", { class: "sp-empty" }, "Select a cause."));
    return;
  }
  const { cause, versus, contributions } = explanation;
  const moving = contributions.filter((each) => Math.abs(each.weight) >= 0.005);
  const flat = contributions.length - moving.length;
  if (contributions.length === 0) {
    why.replaceChildren(h("p", { class: "sp-empty" }, "No observations yet, so each cause has the same probability."));
    return;
  }
  const total = contributions.reduce((sum, each) => sum + each.weight, 0);
  const [more, less] = total >= 0 ? [cause, versus] : [versus, cause];
  const scale = Math.max(1, ...moving.map((each) => Math.abs(each.weight)));
  why.replaceChildren(
    h(
      "p",
      {},
      "Each observation multiplies the odds of ",
      h("code", {}, cause.id),
      " against ",
      h("code", {}, versus.id),
      " by its factor. The factor is the ratio of the likelihoods of the two causes.",
    ),
    h(
      "ul",
      { class: "weights" },
      moving.map((each) =>
        h(
          "li",
          { class: each.weight > 0 ? "weight for" : "weight against" },
          observation(each.evidence),
          h("span", { class: "wbar", "aria-hidden": "true" }, h("span", { style: `--w: ${width(Math.abs(each.weight) / scale / 2)}` })),
          h("b", { class: "factor" }, factorText(each.weight)),
        ),
      ),
    ),
    h(
      "p",
      { class: "sum" },
      "Together: ",
      h("b", {}, factorText(total)),
      ". Each cause has the same prior, so ",
      h("code", {}, more.id),
      ` is ${factorText(total).slice(1)} times as probable as `,
      h("code", {}, less.id),
      `: ${percent(more.probability)} against ${percent(less.probability)}.`,
      flat > 0 ? ` ${String(flat)} more observation${flat === 1 ? "" : "s"} do not change these odds.` : "",
    ),
  );
}

/** This function shows the board, the diagnosis, the causes and the explanation. */
function showBoard(): void {
  for (const button of hostButtons) {
    const side = button.dataset["host"] === "reference" ? "reference" : "target";
    const count = Object.keys(board[side]).length;
    button.setAttribute("aria-checked", String(side === host));
    button.textContent = `${side === "target" ? "The target" : "A second host"} (${String(count)})`;
  }
  byId("board-host-note").textContent =
    host === "target"
      ? "The target is the host that has the problem."
      : "A second host is a reference, for example a public server. A fault of the local network changes the two hosts. A fault of the target changes only the target.";
  for (const button of valueButtons) {
    const feature = button.dataset["feature"] ?? "";
    button.setAttribute("aria-pressed", String(board[host][feature] === button.dataset["value"]));
  }
  const diagnosis = diagnoseBoard(board);
  const count = diagnosis.used.length;
  byId("board-count").textContent = count === 0 ? "No observations." : `${String(count)} observation${count === 1 ? "" : "s"}.`;
  const top = diagnosis.causes[0];
  const second = diagnosis.causes[1];
  const box = byId("board-verdict");
  if (top === undefined || count === 0) {
    box.replaceChildren(h("p", { class: "sp-empty" }, `No observations yet. Each of the ${String(CATALOG.hypotheses.length)} causes has the same probability. Pick a value, or an example.`));
  } else if (top.id === NONE) {
    box.replaceChildren(verdict(true, `No fault, ${percent(top.probability)}:`, " the observations agree with a network that works."));
  } else if (top.id === UNKNOWN) {
    box.replaceChildren(verdict(false, `An unknown cause, ${percent(top.probability)}:`, " no fault of the catalog explains the observations together. ", top.step));
  } else {
    box.replaceChildren(verdict(false, `${top.summary.replace(/\.$/, "")}, ${percent(top.probability)}:`, " ", top.step));
  }
  if (top !== undefined && second !== undefined && count > 0 && top.probability < 0.5) {
    box.append(h("p", { class: "note small" }, "No cause has half of the probability. Demo 2 picks the probe that tells the causes apart."));
  }
  const id = selected ?? top?.id ?? NONE;
  showCauses(byId("board-causes"), diagnosis, {
    count: 6,
    selected: id,
    pick: (pick) => {
      selected = pick;
      showBoard();
    },
  });
  showWhy(diagnosis, id);
}

examples(
  byId("board-chips"),
  SCENARIOS.map((scenario) => [scenario.label, scenario.label] as const),
  (label) => {
    const scenario = SCENARIOS.find((each) => each.label === label);
    if (scenario === undefined) return;
    board.target = { ...scenario.board.target };
    board.reference = { ...scenario.board.reference };
    host = "target";
    selected = undefined;
    showBoard();
  },
);
showBoard();

// 2. Find a hidden fault

const truthSelect = byId<HTMLSelectElement>("search-truth");
const searchSeed = byId<HTMLInputElement>("search-seed");
truthSelect.replaceChildren(
  h("option", { value: "hidden" }, "A hidden fault, drawn from the seed"),
  ...TRUTHS.map((id) => h("option", { value: id }, id === NONE ? "No fault" : `${id}: ${hypothesisOf(id).summary}`)),
);
let runs: string[] = [];

const seedText = (): string => String(Math.max(1, Math.trunc(Number(searchSeed.value)) || 1));
const hidden = (): boolean => truthSelect.value === "hidden";
const truthOf = (): string => (hidden() ? hiddenTruth(seedText()) : truthSelect.value);

/** This function shows the state of the search: the result, the probes, the causes and the steps. */
function showSearch(): void {
  const truth = truthOf();
  const state = search(truth, seedText(), runs);
  const done = searchDone(state);
  const shown = !hidden() || done;
  const top = state.diagnosis.causes[0];
  const truthP = state.diagnosis.causes.find((cause) => cause.id === truth)?.probability ?? 0;

  const result = byId("search-result");
  const time = `${String(state.steps.length)} probe${state.steps.length === 1 ? "" : "s"}, ${String(state.time)} s of probes`;
  if (top === undefined) result.replaceChildren();
  else if (done) {
    const sure = top.probability >= FOUND;
    const found = top.id === truth;
    result.replaceChildren(
      verdict(
        found,
        found ? `Found ${top.id}, ${percent(top.probability)}:` : `The model names ${top.id}, ${percent(top.probability)}:`,
        ` ${time}. `,
        sure ? "" : "No probe of the demo adds information. ",
        "The fault of the network is ",
        h("code", {}, truth),
        ".",
      ),
    );
  } else {
    result.replaceChildren(
      h(
        "p",
        { class: "summary" },
        state.steps.length === 0 ? "No probes yet. " : `${time}. `,
        shown ? ["The fault is ", h("code", {}, truth), ` with ${percent(truthP)}. `] : "The fault is hidden. ",
        `The search ends when a cause has ${percent(FOUND)}.`,
      ),
    );
  }
  byId<HTMLButtonElement>("search-best").disabled = done;
  byId<HTMLButtonElement>("search-auto").disabled = done;
  byId<HTMLButtonElement>("search-reset").disabled = runs.length === 0;

  const most = Math.max(GAIN_RESOLUTION, ...state.ranked.map((choice) => choice.gain));
  byId("search-probes").replaceChildren(
    ...state.ranked.map((choice, index) => {
      const counted = new Set(choice.counted.map((item) => `${item.feature}/${String(item.primary)}`));
      const best = index === 0 && choice.gain > GAIN_RESOLUTION && !done;
      const run = h("button", { type: "button", class: best ? "primary" : "" }, "Run");
      run.disabled = choice.counted.length === 0;
      run.setAttribute("aria-label", `Run: ${PROBES.find((each) => each.id === choice.candidate.id)?.label ?? choice.candidate.id}`);
      run.addEventListener("click", () => {
        runs = [...runs, choice.candidate.id];
        showSearch();
      });
      const probe = PROBES.find((each) => each.id === choice.candidate.id);
      return h(
        "li",
        { class: best ? "probe best" : "probe" },
        h(
          "div",
          { class: "probe-head" },
          h("b", {}, probe?.label ?? choice.candidate.id),
          best ? h("span", { class: "tag next" }, "next") : null,
          h("span", { class: "probe-gain" }, `${choice.gain.toFixed(2)} bits`),
          h("span", { class: "probe-time" }, `${String(choice.candidate.cost ?? 0)} s`),
          run,
        ),
        h("span", { class: "meter", style: `--p: ${width(choice.gain / most)}` }),
        h(
          "p",
          { class: "probe-features" },
          choice.candidate.observes.map((item) =>
            counted.has(`${item.feature}/${String(item.primary)}`) ? h("code", {}, item.feature) : h("code", { class: "seen", title: "Observed before" }, item.feature),
          ),
          choice.candidate.observes[0]?.primary === false ? h("span", { class: "tag" }, "second host") : null,
        ),
      );
    }),
  );
  showCauses(byId("search-causes"), state.diagnosis, { count: 5, truth: shown ? truth : undefined });
  byId("search-steps").replaceChildren(
    ...(state.steps.length === 0
      ? [h("li", { class: "sp-empty" }, "No probes yet.")]
      : state.steps.map((step) => {
          const lead = step.diagnosis.causes[0];
          const p = step.diagnosis.causes.find((cause) => cause.id === truth)?.probability ?? 0;
          return h(
            "li",
            { class: "step" },
            h("b", {}, step.probe.label),
            h("span", { class: "step-obs" }, step.observed.length === 0 ? h("span", { class: "sp-empty" }, "nothing new") : step.observed.map(observation)),
            h(
              "span",
              { class: "step-top" },
              "The top cause: ",
              h("code", {}, lead?.id ?? "none"),
              ` ${percent(lead?.probability ?? 0)}.`,
              shown ? [" The fault: ", h("span", { class: "meter small", style: `--p: ${width(p)}` }), ` ${percent(p)}.`] : "",
            ),
          );
        })),
  );
}

byId("search-best").addEventListener("click", () => {
  const state = search(truthOf(), seedText(), runs);
  const best = state.ranked[0];
  if (best !== undefined && best.gain > GAIN_RESOLUTION) runs = [...runs, best.candidate.id];
  showSearch();
});
byId("search-auto").addEventListener("click", () => {
  runs = autoSearch(truthOf(), seedText(), runs);
  showSearch();
});
byId("search-reset").addEventListener("click", () => {
  runs = [];
  showSearch();
});
for (const control of [truthSelect, searchSeed]) {
  control.addEventListener("input", () => {
    runs = [];
    showSearch();
  });
}
showSearch();

// 3. Score the catalog

const labRuns = byId<HTMLInputElement>("lab-runs");
const labBar = byId<HTMLInputElement>("lab-bar");
const labSeed = byId<HTMLInputElement>("lab-seed");
const labProbes = PROBES.map((probe) => {
  const box = h("input", { type: "checkbox", value: probe.id, checked: true });
  byId("lab-probes").append(h("label", { class: "check" }, box, h("span", {}, probe.label)));
  return box;
});

/** This function makes the runs of the lab and shows the score and the gate. */
function showLab(): void {
  const runsEach = Number(labRuns.value);
  const bar = Number(labBar.value);
  byId("lab-runs-value").textContent = String(runsEach);
  byId("lab-bar-value").textContent = bar.toFixed(2);
  const probes = labProbes.filter((box) => box.checked).map((box) => box.value);
  const lab = runLab({ runs: runsEach, seed: String(Math.max(1, Math.trunc(Number(labSeed.value)) || 1)), probes, bar });
  const { score, gate } = lab;
  const failed = gate.verdicts.filter((each) => each.status !== "pass");
  byId("lab-result").replaceChildren(
    h(
      "p",
      { class: "summary" },
      `${String(score.n)} runs: ${String(TRUTHS.length)} hypotheses, ${String(runsEach)} runs of each. The top cause is the truth in ${String(score.correct)} runs, ${percent(score.correct / Math.max(1, score.n))} `,
      `(interval ${percent(score.accuracy.low)} to ${percent(score.accuracy.high)}). The mean Brier score is ${score.brier === undefined ? "none" : score.brier.toFixed(3)}, and 0 is a perfect score.`,
    ),
    gate.pass
      ? verdict(true, "The gate passes:", ` the recall interval of each of the ${String(gate.verdicts.length)} hypotheses starts at ${bar.toFixed(2)} or more.`)
      : verdict(
          false,
          "The gate fails:",
          ` ${String(failed.length)} of ${String(gate.verdicts.length)} hypotheses have a recall interval that starts below ${bar.toFixed(2)}.`,
          probes.length === 0 ? " No probe observes the network, so the model can name only no fault." : "",
        ),
  );
  const classes = new Map(score.classes.map((each) => [each.label, each]));
  byId("lab-rows").replaceChildren(
    ...gate.verdicts.map((each) => {
      const scores = classes.get(each.hypothesis);
      const interval = scores?.recallInterval ?? { low: 0, high: 1 };
      const recall = scores?.recall;
      const mistake = lab.mistakes.get(each.hypothesis);
      return h(
        "li",
        { class: `recall ${each.status}` },
        h(
          "div",
          { class: "recall-head" },
          h("code", {}, each.hypothesis),
          h("span", { class: `tag ${each.status}` }, each.status),
          h("span", { class: "recall-value" }, recall === undefined ? "no runs" : `recall ${percent(recall)}, interval ${percent(interval.low)} to ${percent(interval.high)}`),
        ),
        h(
          "span",
          { class: "track", "aria-hidden": "true" },
          h("span", { class: "range", style: `left: ${width(interval.low)}; width: ${width(interval.high - interval.low)}` }),
          recall === undefined ? null : h("span", { class: "point", style: `left: ${width(recall)}` }),
          h("span", { class: "line", style: `left: ${width(each.bar)}` }),
        ),
        mistake === undefined ? null : h("p", { class: "mistake" }, "Mistaken most for ", h("code", {}, mistake.id), ` (${String(mistake.count)} of ${String(each.support)} runs).`),
      );
    }),
    ...gate.unbarred.map((id) => h("li", { class: "recall unbarred" }, h("div", { class: "recall-head" }, h("code", {}, id), h("span", { class: "tag" }, "no bar")), h("p", { class: "mistake" }, "No lab makes an unknown cause, so it has no runs and no bar."))),
  );
}

const labLater = later(showLab, 120);
for (const control of [labRuns, labBar, labSeed]) control.addEventListener("input", () => {
  byId("lab-runs-value").textContent = labRuns.value;
  byId("lab-bar-value").textContent = Number(labBar.value).toFixed(2);
  labLater();
});
for (const box of labProbes) box.addEventListener("change", showLab);
showLab();

// 4. Read a check report

/** The names of the rings of the network, from the computer to the service. */
const RING_NAMES: Readonly<Record<RingId, string>> = {
  interface: "The interface",
  wifi: "The Wi-Fi link",
  gateway: "The gateway",
  resolver: "The DNS resolver",
  path: "The path",
  service: "The service",
  other: "Another part",
  unknown: "An unknown cause",
  none: "No fault",
};

/** The ids of the views of a report. A file that is not a report empties them. */
const REPORT_VIEWS = ["report-head", "report-rings", "report-path", "report-flow", "report-causes", "report-next", "report-timeline"] as const;

const reportSample = byId<HTMLSelectElement>("report-sample");
const reportFile = byId<HTMLInputElement>("report-file");
const reportText = byId<HTMLTextAreaElement>("report-text");
/** The files of the samples: the cases of the loopback lab, and the where cases of the kernel lab. */
const SAMPLE_FILES = [
  { key: "loopback", label: "The loopback lab", json: samplesJson },
  { key: "where", label: "The kernel lab: where the loss starts", json: whereSamplesJson },
] as const;

/** A sample of a file of the lab. The key has the key of the file and the id of the case, because two files can have one id. */
interface LabSample {
  readonly key: string;
  readonly file: string;
  readonly sample: CheckSample;
}

const samples: readonly LabSample[] = SAMPLE_FILES.flatMap((file) => {
  const read = readSamples(file.json);
  if (read.tag === "err") {
    console.error(`The samples of ${file.label} have problems:`, read.error);
    return [];
  }
  return read.value.samples.map((sample) => ({ key: `${file.key}/${sample.id}`, file: file.key, sample }));
});

/** This function shows the problems of a file that is not a report, and removes the views of the last report. */
function showReportProblems(what: string, problems: readonly string[]): void {
  byId("report-problems").replaceChildren(
    h("div", { class: "sp-empty problems" }, h("p", {}, `The page cannot read ${what} as a report:`), h("ul", {}, ...problems.map((problem) => h("li", {}, problem)))),
  );
  for (const id of REPORT_VIEWS) byId(id).replaceChildren();
}

/** This function shows the verdict of a report: the most probable cause and its step. */
function reportVerdict(report: CheckReport): HTMLElement {
  const top = report.causes[0];
  if (top === undefined) return h("p", { class: "sp-empty" }, "The report has no causes.");
  if (top.id === NONE) return verdict(true, `No fault, ${percent(top.probability)}:`, " the observations agree with a network that works.");
  if (top.id === UNKNOWN) return verdict(false, `An unknown cause, ${percent(top.probability)}:`, " no fault of the catalog explains the observations together. ", top.step);
  return verdict(false, `${top.summary.replace(/\.$/, "")}, ${percent(top.probability)}:`, " ", top.step);
}

/** This function shows an observation of a layer, with its tone. */
function flowItem(item: FlowItem): HTMLElement {
  return h(
    "li",
    { class: `obs-item ${item.tone}${item.ignored === undefined ? "" : " ignored"}`, title: item.ignored ?? "" },
    observation(item.evidence),
    item.ignored === undefined ? null : h("span", { class: "tag" }, "not used"),
  );
}

/** This function gives a list of code names, separated by commas. */
function codeList(names: readonly string[]): (string | HTMLElement)[] {
  return names.flatMap((name, index) => [index === 0 ? "" : ", ", h("code", {}, name)]);
}

/** The most case ids that the detail of a cell names for one world. A world with more cases gives its count and its first and last ids. */
const NAMED_CASES = 3;

/** This function gives the cases of one world in a cell. A long list gives its count and its first and last ids. */
function caseList(cases: readonly string[]): (string | HTMLElement)[] {
  if (cases.length <= NAMED_CASES) return codeList(cases);
  return [`${counted(cases.length, "case")}, `, h("code", {}, cases[0] ?? ""), " to ", h("code", {}, cases.at(-1) ?? "")];
}

/** This function shows the verdict and the facts of a report. `truth` is the fault of a lab sample. */
function showReportHead(report: CheckReport, source: string, truth: string | undefined): void {
  const unended = report.problems.length;
  const named = report.causes[0]?.id === truth ? ", and the check names it first." : ", and the check names another cause first.";
  byId("report-head").replaceChildren(
    h(
      "p",
      { class: "report-target" },
      h("code", {}, `${report.scheme}://${report.target}${report.path}`),
      ` ${source}: ${String(report.facts.length)} facts, ${String(report.evidence.length)} observations${unended === 0 ? "" : `, ${String(unended)} probes that did not end`}.`,
    ),
    reportVerdict(report),
    ...(truth === undefined ? [] : [h("p", { class: "note small" }, "The fault of this lab case is ", h("code", {}, truth), named)]),
  );
}

/** This function shows the probability of each ring of the network. */
function showRings(report: CheckReport): void {
  const rings = ringsOf(report.causes);
  const most = Math.max(...rings.map((ring) => ring.probability));
  byId("report-rings").replaceChildren(
    ...rings.map((ring) =>
      h(
        "li",
        { class: `ring${ring.probability === most && most > 0 ? " most" : ""}${ring.ring === "none" ? " healthy" : ""}`, style: `--p: ${width(ring.probability)}` },
        h("span", { class: "ring-name" }, RING_NAMES[ring.ring]),
        h("b", { class: "pct" }, percent(ring.probability)),
        // The ring names its top cause only when its percent is not 0%.
        ring.top === undefined || percent(ring.probability) === "0%" ? null : h("code", { class: "ring-top" }, ring.top.id),
      ),
    ),
  );
}

/** The tag of a hop in the part where the loss starts, and of the hop before the part. */
const PLACE_TAGS: Readonly<Record<PathHop["place"], string>> = { start: "the loss can start", bound: "clearly lower loss", clear: "" };

/** This function shows a hop of a path: its TTL, its address, its loss and its network. */
function pathHop(hop: PathHop): HTMLElement {
  return h(
    "li",
    { class: `hop ${hop.place}` },
    h("span", { class: "hop-ttl" }, String(hop.ttl)),
    h("code", { class: "hop-address" }, hop.address ?? "*"),
    h("span", { class: "hop-loss" }, h("span", { class: "meter", style: `--p: ${width(hop.loss ?? 0)}` }), h("span", { class: "pct" }, hop.lossText)),
    h("span", { class: "hop-network" }, hop.network),
    hop.place === "clear" ? null : h("span", { class: `tag ${hop.place === "start" ? "unusual" : "usual"}` }, PLACE_TAGS[hop.place]),
  );
}

/** This function shows one report of mtr: the sentence of the start, the hops, and the networks where the loss can start. */
function pathView(view: PathView): HTMLElement {
  const hops = view.hops.length;
  return h(
    "div",
    { class: "path" },
    h("p", { class: "path-summary" }, h("b", {}, view.summary)),
    h("p", { class: "note small" }, `From ${view.subject}: ${String(hops)} hop${hops === 1 ? "" : "s"}, ${String(view.cycles)} cycles of mtr.`, ...view.notes.map((note) => ` ${note}`)),
    h("ol", { class: "hops", "aria-label": `The hops to ${view.address}` }, ...view.hops.map(pathHop)),
    view.networks.length === 0
      ? null
      : h("ul", { class: "start-networks", "aria-label": "The networks where the loss can start" }, ...view.networks.map((network) => h("li", {}, h("b", {}, network.name), `: ${network.hops}`))),
  );
}

/** This function shows the path of each report of mtr. A report with no report of mtr shows one short line. */
function showPaths(report: CheckReport): void {
  const views = pathsOf(report);
  byId("report-path").replaceChildren(...(views.length === 0 ? [h("p", { class: "sp-empty" }, "No path: the check did not trace the path with mtr.")] : views.map(pathView)));
}

/** This function shows the observations of each layer. */
function showFlow(report: CheckReport): void {
  byId("report-flow").replaceChildren(
    ...flowOf(report).map((row) =>
      h(
        "li",
        { class: `flow-layer ${row.state}` },
        h("span", { class: "flow-name" }, LAYER_NAMES[row.layer]),
        h("span", { class: `tag ${row.state}` }, row.state === "none" ? "no observation" : row.state),
        row.facts === 0 ? null : h("span", { class: "flow-facts" }, `${String(row.facts)} fact${row.facts === 1 ? "" : "s"}`),
        row.target.length === 0 ? null : h("ul", { class: "obs-list", "aria-label": "The target" }, ...row.target.map(flowItem)),
        row.others.length === 0 ? null : h("ul", { class: "obs-list others", "aria-label": "The other hosts" }, ...row.others.map(flowItem)),
      ),
    ),
  );
}

/** This function shows the next step of a report, and the count of the other steps. */
function showNext(report: CheckReport): void {
  const next = report.next;
  byId("report-next").replaceChildren(
    next === null
      ? h("p", { class: "sp-empty" }, "No probe can tell more about the most probable causes.")
      : h(
          "div",
          { class: "next-step" },
          h("p", {}, h("b", {}, next.step)),
          h("p", { class: "note small" }, `It can give ${next.gain.toFixed(2)} bits of information about the causes. It observes `, ...codeList(next.observes.map((item) => item.feature)), "."),
          report.choices.length < 2 ? null : h("p", { class: "note small" }, `${String(report.choices.length - 1)} other steps, for example `, ...codeList(report.choices.slice(1, 4).map((step) => step.id)), "."),
        ),
  );
}

/** This function shows each fact of a report on a lane of its host, at its time. */
function showTimeline(report: CheckReport): void {
  const timeline = timelineOf(report);
  const span = Math.max(timeline.span, 1);
  const lanes = timeline.lanes.map((lane, index) =>
    h(
      "div",
      { class: "lane" },
      h("span", { class: "lane-name" }, lane),
      h(
        "span",
        { class: "lane-track" },
        ...timeline.bars
          .filter((bar) => bar.lane === index)
          .map((bar) =>
            h("span", {
              class: "bar",
              "data-layer": bar.layer,
              style: `left: ${width(bar.start / span)}; width: max(3px, ${width((bar.end - bar.start) / span)})`,
              title: `${bar.kind}: ${bar.start.toFixed(0)} to ${bar.end.toFixed(0)} ms`,
            }),
          ),
      ),
    ),
  );
  byId("report-timeline").replaceChildren(
    ...lanes,
    lanes.length === 0 ? h("p", { class: "sp-empty" }, "The report has no facts.") : h("p", { class: "lane-axis note small" }, h("span", {}, "0 ms"), h("span", {}, `${timeline.span.toFixed(0)} ms`)),
  );
}

/** This function shows each view of a report. `truth` is the fault of a lab sample. */
function showReport(report: CheckReport, source: string, truth?: string): void {
  byId("report-problems").replaceChildren();
  showReportHead(report, source, truth);
  showRings(report);
  showPaths(report);
  showFlow(report);
  showCauses(byId("report-causes"), { causes: report.causes, used: report.evidence, ignored: report.ignored }, { count: 5, truth });
  showNext(report);
  showTimeline(report);
}

/** This function reads the text of a file or of the paste box, and shows the report or its problems. */
function readReportText(text: string, source: string): void {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    showReportProblems(source, ["The text is not JSON. Write the report with the option --json."]);
    return;
  }
  const read = readCheckReport(value);
  if (read.tag === "err") {
    showReportProblems(source, read.error);
    return;
  }
  reportSample.value = "";
  showReport(read.value, `From ${source}`);
}

/** This function reads the file of a visitor. */
async function readReportFile(file: File): Promise<void> {
  readReportText(await file.text(), `the file ${file.name}`);
}

/** This function shows the selected sample of the lab, or the first sample. */
function showSample(): void {
  const chosen = samples.find((each) => each.key === reportSample.value) ?? samples[0];
  if (chosen === undefined) return;
  reportSample.value = chosen.key;
  showReport(chosen.sample.report, `The lab case ${chosen.sample.id}`, chosen.sample.truth);
}

reportSample.replaceChildren(
  ...SAMPLE_FILES.map((file) =>
    h(
      "optgroup",
      { label: file.label },
      ...samples.filter((each) => each.file === file.key).map((each) => h("option", { value: each.key }, `${each.sample.id}: ${each.sample.summary}`)),
    ),
  ),
);
reportSample.addEventListener("input", showSample);
reportFile.addEventListener("change", () => {
  const file = reportFile.files?.[0];
  if (file !== undefined) void readReportFile(file);
});
byId("report-read").addEventListener("click", () => {
  readReportText(reportText.value, "the pasted text");
});
const reportSection = byId("report-section");
reportSection.addEventListener("dragover", (event) => {
  event.preventDefault();
  reportSection.classList.add("dropping");
});
reportSection.addEventListener("dragleave", () => {
  reportSection.classList.remove("dropping");
});
reportSection.addEventListener("drop", (event) => {
  event.preventDefault();
  reportSection.classList.remove("dropping");
  const file = event.dataTransfer?.files[0];
  if (file !== undefined) void readReportFile(file);
});
showSample();

// 5. Where each fault class is tested

/** The filters of the matrix: all cells, or only the cells of some states. */
type LadderFilter = "all" | "gaps" | "covered" | "impossible";

/** The ladder of the lab. The command `pnpm --filter @netdiag/lab roadmap` writes the file, and a test of the lab keeps it current. */
const LADDER = coverageJson as unknown as SiteLadder;

/** The states that each filter shows. */
const FILTER_STATES: Readonly<Record<LadderFilter, readonly LadderState[]>> = {
  all: ["covered", "no-bar", "gap", "no-class", "impossible"],
  gaps: LADDER.gapStates,
  covered: ["covered"],
  impossible: ["impossible"],
};

/** The text of a filter that shows no cell. */
const FILTER_EMPTY: Readonly<Record<LadderFilter, string>> = {
  all: "The ladder has no cell.",
  gaps: "No cell is a gap. The work of the ladder is done.",
  covered: "No cell is covered yet.",
  impossible: "No cell is impossible: no class needs a thing that a layer cannot prove. Thus each cell that is not covered is a gap.",
};

const coverageFilters = [...byId("coverage-filter").querySelectorAll<HTMLButtonElement>("[data-filter]")];
const coverageProposals = byId<HTMLInputElement>("coverage-proposals");
let ladderFilter: LadderFilter = "all";
/** The selected cell: the id of its row and its layer. */
let ladderPick: { readonly row: string; readonly layer: string } | undefined;

/** This function gives a count with its noun, for example "1 cell" or "17 cells". */
const counted = (count: number, one: string, many = `${one}s`): string => `${String(count)} ${count === 1 ? one : many}`;

/** This function gives the mark of a state, as text. A color alone does not tell the state. */
const markOf = (state: LadderState): string => LADDER.states[state].mark;

/** This function shows the headline of the ladder: the gaps first, then the covered and the impossible cells, of all cells. */
function showLadderHead(): void {
  const { total, classes, proposals } = LADDER.counts;
  const classRows = LADDER.rows.filter((row) => row.kind === "class").length;
  byId("coverage-head").replaceChildren(
    h("p", { class: "ladder-total" }, h("b", { class: "ladder-gaps" }, counted(total.gaps, "gap")), h("span", {}, ` in ${counted(total.cells, "cell")}`)),
    h(
      "p",
      { class: "ladder-counts" },
      h("span", { class: "ladder-count" }, h("span", { class: "ladder-mark covered", "aria-hidden": "true" }, markOf("covered")), ` ${counted(total.covered, "cell")} covered`),
      h("span", { class: "ladder-count" }, h("span", { class: "ladder-mark impossible", "aria-hidden": "true" }, markOf("impossible")), ` ${counted(total.impossible, "cell")} impossible`),
    ),
    h(
      "p",
      { class: "note small" },
      `The ${String(classRows)} classes of the catalog have ${counted(classes.gaps, "gap")}. The ${String(LADDER.rows.length - classRows)} classes that the fault grammar proposes have ${counted(proposals.gaps, "gap")}.`,
    ),
  );
}

/** This function shows the key of the marks. */
function showLadderKey(): void {
  byId("coverage-key").replaceChildren(
    ...FILTER_STATES.all.map((state) => h("li", {}, h("span", { class: `ladder-mark ${state}`, "aria-hidden": "true" }, markOf(state)), ` ${LADDER.states[state].name}`)),
  );
}

/** This function gives the label of a cell for a screen reader. */
function cellLabel(row: LadderRow, cell: LadderCell): string {
  const cases = cell.worlds.flatMap((each) => each.cases);
  const more = cell.state === "covered" ? `, ${counted(cases.length, "case")}` : "";
  return `${row.id} on ${cell.layer}: ${LADDER.states[cell.state].name}${more}`;
}

/** This function gives the button of a cell. A click selects the cell and shows its details. */
function cellButton(row: LadderRow, cell: LadderCell, shown: boolean): HTMLElement {
  const picked = ladderPick?.row === row.id && ladderPick.layer === cell.layer;
  const button = h(
    "button",
    { type: "button", class: `ladder-cell ${cell.state}`, "aria-label": cellLabel(row, cell), "aria-pressed": String(picked), "data-row": row.id, "data-layer": cell.layer },
    markOf(cell.state),
  );
  button.addEventListener("click", () => {
    ladderPick = { row: row.id, layer: cell.layer };
    showLadder();
  });
  return h("td", { class: shown ? undefined : "dim" }, button);
}

/** This function shows the matrix: a group of rows for each layer of netdiag, and a cell for each layer of the lab. */
function showLadder(): void {
  for (const button of coverageFilters) button.setAttribute("aria-checked", String(button.dataset["filter"] === ladderFilter));
  const states = FILTER_STATES[ladderFilter];
  const rows = LADDER.rows.filter((row) => (coverageProposals.checked || row.kind === "class") && row.cells.some((cell) => states.includes(cell.state)));
  const head = h(
    "thead",
    {},
    h("tr", {}, h("th", { scope: "col", class: "ladder-class" }, "Class"), ...LADDER.layers.map((layer) => h("th", { scope: "col", title: layer.name }, layer.id))),
  );
  const groups = LAYERS.flatMap((layer) => {
    const members = rows.filter((row) => row.layer === layer);
    if (members.length === 0) return [];
    return [
      h("tr", { class: "ladder-group" }, h("th", { scope: "colgroup", colspan: LADDER.layers.length + 1 }, h("span", {}, LAYER_NAMES[layer]))),
      ...members.map((row) =>
        h(
          "tr",
          { class: row.kind === "proposal" ? "proposal" : undefined },
          h("th", { scope: "row", class: "ladder-class" }, h("code", {}, row.id), row.kind === "proposal" ? h("span", { class: "tag" }, "proposed") : null),
          ...row.cells.map((cell) => cellButton(row, cell, states.includes(cell.state))),
        ),
      ),
    ];
  });
  byId("coverage-matrix").replaceChildren(head, h("tbody", {}, ...groups));
  const empty = byId("coverage-empty");
  empty.hidden = rows.length > 0;
  empty.textContent = rows.length > 0 ? "" : FILTER_EMPTY[ladderFilter];
  showLadderDetail();
}

/** This function gives the name and the layer of a world of the ladder. */
function worldName(id: string): string {
  const world = LADDER.worlds.find((each) => each.id === id);
  return world === undefined ? id : `${world.name} (${world.layer})`;
}

/** This function shows the details of the selected cell. A covered cell gives its cases, an impossible cell its reason, and a gap its needs. */
function showLadderDetail(): void {
  const box = byId("coverage-detail");
  const row = LADDER.rows.find((each) => each.id === ladderPick?.row);
  const cell = row?.cells.find((each) => each.layer === ladderPick?.layer);
  if (row === undefined || cell === undefined) {
    box.replaceChildren(h("p", { class: "sp-empty" }, "Pick a cell to see its cases, its reason or what it needs."));
    return;
  }
  const layer = LADDER.layers.find((each) => each.id === cell.layer);
  const parts: HTMLElement[] = [
    h("p", { class: "ladder-detail-title" }, h("code", {}, row.id), ` on ${cell.layer}`, layer === undefined ? "" : `: ${layer.name}`),
    h("p", {}, h("span", { class: `ladder-mark ${cell.state}`, "aria-hidden": "true" }, markOf(cell.state)), " ", h("b", {}, LADDER.states[cell.state].name), "."),
  ];
  if (cell.state === "covered" || cell.state === "no-bar") {
    const worlds = cell.worlds.map((each) => h("li", {}, `${worldName(each.world)}: `, ...caseList(each.cases), each.bar ? ", with a bar." : ", with no bar."));
    parts.push(h("ul", { class: "ladder-worlds" }, ...worlds));
  } else if (cell.state === "impossible") {
    const limits = cell.limits.map((each) =>
      h("li", {}, `${each.layer} cannot prove "${each.reason}". Thus it cannot have ${LADDER.traits[each.trait]}. Source: `, h("a", { href: LADDER.source }, each.source), "."),
    );
    parts.push(h("ul", { class: "ladder-worlds" }, ...limits));
  } else {
    const needs = row.needs.map((trait) => LADDER.traits[trait]);
    const what = cell.state === "no-class" ? "The catalog has no class for it yet, so no world has a case of it." : "No world of the layer has a case of the class.";
    parts.push(h("p", {}, `${what} `, needs.length > 0 ? `A world for it needs ${needs.join(" and ")}.` : "A world for it needs no special trait."));
    if (row.entries.length > 0) parts.push(h("p", { class: "note small" }, "The entries of the atlas that propose it: ", ...codeList(row.entries), "."));
  }
  const options = row.options.map((id) => h("li", {}, h("code", {}, id), `: ${LADDER.options[id] ?? ""}`));
  if (options.length > 0) parts.push(h("p", { class: "note small" }, "The options of the fault grammar that give it:"), h("ul", { class: "ladder-worlds small" }, ...options));
  box.replaceChildren(...parts);
}

/** This function shows the key of the layers: the name, the state and the limits of each layer, with the counts of its cells. */
function showLadderLayers(): void {
  byId("coverage-layers").replaceChildren(
    ...LADDER.layers.map((layer, at) => {
      const cells = LADDER.rows.flatMap((row) => row.cells.slice(at, at + 1));
      const covered = cells.filter((cell) => cell.state === "covered").length;
      const gaps = cells.filter((cell) => LADDER.gapStates.includes(cell.state)).length;
      const cannot = layer.cannot.map((each) => each.charAt(0).toLowerCase() + each.slice(1)).join(", ");
      const limits = layer.cannot.length > 0 ? `It cannot prove ${cannot}.` : "The plan names no thing that it cannot prove.";
      return h(
        "li",
        { class: "ladder-layer" },
        h("span", { class: "ladder-layer-head" }, h("b", {}, layer.id), h("span", {}, layer.name), h("span", { class: covered > 0 ? "tag pass" : "tag" }, layer.stateText)),
        h("span", { class: "note small" }, `${counted(covered, "cell")} covered, ${counted(gaps, "gap")}. ${limits}`),
      );
    }),
  );
}

for (const button of coverageFilters) {
  button.addEventListener("click", () => {
    const filter = button.dataset["filter"];
    if (filter === "all" || filter === "gaps" || filter === "covered" || filter === "impossible") ladderFilter = filter;
    showLadder();
  });
}
coverageProposals.addEventListener("change", showLadder);
byId<HTMLAnchorElement>("coverage-source").href = LADDER.source;
showLadderHead();
showLadderKey();
showLadderLayers();
showLadder();
