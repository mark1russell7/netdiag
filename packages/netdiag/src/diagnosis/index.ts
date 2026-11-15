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
export { LAYERS, isLayer, layerRank, type Layer } from "../layer.ts";
