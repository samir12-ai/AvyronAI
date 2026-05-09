/**
 * Engine Contract Registry — Public surface (Phase C0 foundation)
 *
 * Importers read everything from this index. Internal split (types /
 * registry / helpers) is an implementation detail.
 *
 * NOTHING in this package is wired into runtime behavior in C0. The next
 * phase (C1) replaces the 5 broken `channel_selection.funnelStages`
 * consumers with `requireContractField(...)` calls; C2 enables shadow-mode
 * validation across all 15 engines behind `ENFORCE_ENGINE_CONTRACTS`.
 */

export type {
  // Trust model (plan §2)
  SnapshotTrustState,
  ContractStatus,
  // Registry schema (plan §4)
  ContractField,
  EngineContract,
  LivenessRule,
  // Boundary-helper return type (plan §1.2)
  ContractFieldResult,
  // API envelope (plan §7)
  LiveSnapshotEnvelope,
  // Engine-status extensions (plan §3)
  ContractEngineStatus,
  // Trust classification inputs
  ProvenanceForTrust,
  ClassifyTrustMode,
} from "./types";

export {
  LIVE_ELIGIBLE_STATES,
  CONTRACT_NOT_REACHED_STATUSES,
  isLiveEligible,
  isLiveEligibleForScaling,
} from "./types";

export { ENGINE_CONTRACT_REGISTRY } from "./registry";

export {
  getContract,
  getRequiredFields,
  getDownstreamConsumers,
  classifyTrust,
  validateContractCompleteness,
  requireContractField,
  wrapAsEnvelope,
} from "./helpers";
