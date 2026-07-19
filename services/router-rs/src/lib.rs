//! Low-latency ranking primitives for the NexusOS skill router.

pub mod router;

pub use router::{
    Candidate, Policy, RankRequest, RankedCandidate, SignalWeights, reciprocal_rank_fusion,
    rerank,
};
