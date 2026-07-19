//! Deterministic signal fusion, policy filtering, and token-budget selection.

use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq)]
pub struct Candidate {
    pub id: String,
    pub domains: BTreeSet<String>,
    pub required_tools: BTreeSet<String>,
    pub cost_level: u8,
    pub risk_level: u8,
    pub estimated_tokens: u32,
    pub semantic_score: f32,
    pub keyword_score: f32,
    pub domain_score: f32,
    pub success_rate: f32,
    pub capability_score: f32,
    pub latency_score: f32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Policy {
    pub allowed_domains: BTreeSet<String>,
    pub allowed_tools: BTreeSet<String>,
    pub maximum_cost_level: u8,
    pub maximum_risk_level: u8,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SignalWeights {
    pub semantic: f32,
    pub keyword: f32,
    pub domain: f32,
    pub success: f32,
    pub capability: f32,
    pub cost: f32,
    pub latency: f32,
}

impl Default for SignalWeights {
    fn default() -> Self {
        Self {
            semantic: 0.30,
            keyword: 0.15,
            domain: 0.15,
            success: 0.15,
            capability: 0.10,
            cost: 0.10,
            latency: 0.05,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct RankRequest {
    pub candidates: Vec<Candidate>,
    pub policy: Policy,
    pub maximum_results: usize,
    pub token_budget: u32,
    pub weights: SignalWeights,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RankedCandidate {
    pub id: String,
    pub score: f32,
    pub estimated_tokens: u32,
    pub signals: BTreeMap<&'static str, f32>,
}

pub fn rerank(request: RankRequest) -> Vec<RankedCandidate> {
    let mut ranked = request
        .candidates
        .into_iter()
        .filter(|candidate| is_allowed(candidate, &request.policy))
        .map(|candidate| score(candidate, request.weights))
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.id.cmp(&right.id))
    });

    let mut selected = Vec::with_capacity(request.maximum_results);
    let mut consumed_tokens = 0_u32;
    for candidate in ranked {
        if selected.len() == request.maximum_results {
            break;
        }
        let next_total = consumed_tokens.saturating_add(candidate.estimated_tokens);
        if next_total > request.token_budget {
            continue;
        }
        consumed_tokens = next_total;
        selected.push(candidate);
    }
    selected
}

pub fn reciprocal_rank_fusion(
    rankings: &[Vec<String>],
    rank_constant: f32,
) -> Vec<(String, f32)> {
    let mut scores = BTreeMap::<String, f32>::new();
    for ranking in rankings {
        for (index, identifier) in ranking.iter().enumerate() {
            let contribution = 1.0 / (rank_constant + index as f32 + 1.0);
            *scores.entry(identifier.clone()).or_default() += contribution;
        }
    }
    let mut fused = scores.into_iter().collect::<Vec<_>>();
    fused.sort_by(|left, right| {
        right
            .1
            .total_cmp(&left.1)
            .then_with(|| left.0.cmp(&right.0))
    });
    fused
}

fn is_allowed(candidate: &Candidate, policy: &Policy) -> bool {
    let domain_allowed = policy.allowed_domains.is_empty()
        || !candidate.domains.is_disjoint(&policy.allowed_domains);
    let tools_allowed = candidate.required_tools.is_subset(&policy.allowed_tools);
    domain_allowed
        && tools_allowed
        && candidate.cost_level <= policy.maximum_cost_level
        && candidate.risk_level <= policy.maximum_risk_level
}

fn score(candidate: Candidate, weights: SignalWeights) -> RankedCandidate {
    let cost_score = match candidate.cost_level {
        0 => 1.0,
        1 => 0.65,
        2 => 0.30,
        _ => 0.0,
    };
    let signals = BTreeMap::from([
        ("semantic", clamp(candidate.semantic_score)),
        ("keyword", clamp(candidate.keyword_score)),
        ("domain", clamp(candidate.domain_score)),
        ("success", clamp(candidate.success_rate)),
        ("capability", clamp(candidate.capability_score)),
        ("cost", cost_score),
        ("latency", clamp(candidate.latency_score)),
    ]);
    let final_score = signals["semantic"] * weights.semantic
        + signals["keyword"] * weights.keyword
        + signals["domain"] * weights.domain
        + signals["success"] * weights.success
        + signals["capability"] * weights.capability
        + signals["cost"] * weights.cost
        + signals["latency"] * weights.latency;
    RankedCandidate {
        id: candidate.id,
        score: final_score,
        estimated_tokens: candidate.estimated_tokens,
        signals,
    }
}

fn clamp(value: f32) -> f32 {
    if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_policy_before_budgeted_selection() {
        let request = RankRequest {
            candidates: vec![
                candidate("authorized", 0.8, 600, &["web.search"]),
                candidate("forbidden", 1.0, 100, &["database.write"]),
                candidate("too-large", 0.9, 1_200, &["web.search"]),
            ],
            policy: Policy {
                allowed_domains: set(&["research"]),
                allowed_tools: set(&["web.search"]),
                maximum_cost_level: 2,
                maximum_risk_level: 1,
            },
            maximum_results: 3,
            token_budget: 1_000,
            weights: SignalWeights::default(),
        };

        let selected = rerank(request);

        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].id, "authorized");
        assert!(selected[0].signals.contains_key("semantic"));
    }

    #[test]
    fn fuses_dense_and_sparse_rankings_deterministically() {
        let dense = vec!["a".to_owned(), "b".to_owned(), "c".to_owned()];
        let sparse = vec!["b".to_owned(), "c".to_owned(), "a".to_owned()];

        let fused = reciprocal_rank_fusion(&[dense, sparse], 60.0);

        assert_eq!(fused[0].0, "b");
        assert_eq!(fused.len(), 3);
    }

    fn candidate(id: &str, score: f32, tokens: u32, tools: &[&str]) -> Candidate {
        Candidate {
            id: id.to_owned(),
            domains: set(&["research"]),
            required_tools: set(tools),
            cost_level: 1,
            risk_level: 1,
            estimated_tokens: tokens,
            semantic_score: score,
            keyword_score: score,
            domain_score: 1.0,
            success_rate: 0.8,
            capability_score: score,
            latency_score: 0.7,
        }
    }

    fn set(values: &[&str]) -> BTreeSet<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }
}
