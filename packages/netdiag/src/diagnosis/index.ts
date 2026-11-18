/**
 * The diagnosis of netdiag: the model of the parts, the catalog of faults, and the probability of each cause.
 *
 * This entry imports no `node:` module, so a browser can also use it.
 */
export {
  ALIKE_EPSILON,
  FLOOR,
  NONE,
  PARTS,
  REACHES,
  STRENGTHS,
  UNKNOWN,
  alikeCauses,
  causeVariants,
  compileCatalog,
  diagnose,
  expand,
  explain,
  predictive,
  type Catalog,
  type CatalogSpec,
  type Cause,
  type CauseVariant,
  type Contribution,
  type Degree,
  type DegreeShare,
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
  type ReachShare,
  type Strength,
} from "./model.ts";
export { LOSS_DEGREES, LOSS_STEPS, STANDARD_CATALOG, STANDARD_CATALOG_SPEC, STANDARD_FAULTS, STANDARD_FEATURES, type LossDegree, type LossStep } from "./catalog.ts";
export { GAIN_RESOLUTION, MAX_JOINT_VALUES, rankProbes, type Candidate, type Observable, type ProbeChoice, type RankOptions } from "./next.ts";
export {
  LAB_BAR_STEP,
  LAB_RECORD_FORMAT,
  labBars,
  labGate,
  labRecordOf,
  scoreLab,
  scoredCause,
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
