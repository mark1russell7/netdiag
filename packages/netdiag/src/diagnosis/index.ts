/**
 * The diagnosis of netdiag: the model of the parts, the catalog of faults, and the probability of each cause.
 *
 * This entry imports no `node:` module, so a browser can also use it.
 */
export {
  FLOOR,
  NONE,
  PARTS,
  STRENGTHS,
  UNKNOWN,
  compileCatalog,
  diagnose,
  expand,
  explain,
  predictive,
  type Catalog,
  type CatalogSpec,
  type Cause,
  type Contribution,
  type Diagnosis,
  type Distribution,
  type Evidence,
  type Expectation,
  type Fault,
  type Feature,
  type Hypothesis,
  type Part,
  type Prediction,
  type Reach,
  type Strength,
} from "./model.ts";
export { STANDARD_CATALOG, STANDARD_CATALOG_SPEC, STANDARD_FAULTS, STANDARD_FEATURES } from "./catalog.ts";
export { GAIN_RESOLUTION, MAX_JOINT_VALUES, rankProbes, type Candidate, type Observable, type ProbeChoice, type RankOptions } from "./next.ts";
export {
  LAB_BAR_STEP,
  LAB_RECORD_FORMAT,
  labBars,
  labGate,
  labRecordOf,
  scoreLab,
  type LabBars,
  type LabBarsOptions,
  type LabCause,
  type LabClassRecall,
  type LabGate,
  type LabRecalls,
  type LabRecord,
  type LabScore,
  type LabStatus,
  type LabVerdict,
} from "./score.ts";
export { LAYERS, isLayer, layerRank, type Layer } from "../layer.ts";
