use agent_pay_registry::{Decision, AgentPayRegistry};

#[test]
fn publishes_dataset_root_and_records_decision() {
    let mut registry = AgentPayRegistry::default();
    let dataset_id = dataset_id(1);
    let dataset_root = hex(2);

    registry.publish_dataset_root(&dataset_id, dataset_root.clone());
    let receipt = registry.record_decision(
        &dataset_id,
        &hex(3),
        &hex(4),
        Decision::Approved,
        1_786_000_000,
    );

    assert_eq!(receipt.dataset_id, dataset_id);
    assert_eq!(receipt.dataset_root, dataset_root);
    assert_eq!(receipt.decision, Decision::Approved);
}

#[test]
fn rejects_decision_for_unknown_dataset() {
    let mut registry = AgentPayRegistry::default();

    let result = std::panic::catch_unwind(move || {
        registry.record_decision(
            &dataset_id(9),
            &hex(10),
            &hex(11),
            Decision::NeedsReview,
            1_786_000_000,
        );
    });

    assert!(result.is_err());
}

#[test]
fn records_decision_with_dataset_root_atomically() {
    let mut registry = AgentPayRegistry::default();
    let dataset_id = dataset_id(12);
    let dataset_root = hex(13);

    let receipt = registry.record_decision_with_root(
        &dataset_id,
        &dataset_root,
        &hex(14),
        &hex(15),
        Decision::NeedsReview,
        1_786_000_100,
    );

    assert_eq!(receipt.dataset_id, dataset_id);
    assert_eq!(receipt.dataset_root, dataset_root);
    assert_eq!(receipt.decision, Decision::NeedsReview);
    assert_eq!(registry.receipts().len(), 1);
}

fn dataset_id(index: u8) -> String {
    format!("dataset-{}", hex(index)[..12].to_string())
}

fn hex(index: u8) -> String {
    format!("{index:02x}").repeat(32)
}
