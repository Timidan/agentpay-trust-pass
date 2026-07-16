use agent_pay_registry::{
    AgentPayRegistry, Decision, ReceiptAnchorInput, ReceiptOutcome, RegistryError,
};

#[test]
fn legacy_decisions_are_authorized_idempotent_and_append_only() {
    let owner = account(10);
    let recorder = account(11);
    let attacker = account(12);
    let mut registry = AgentPayRegistry::new(owner.clone(), recorder);
    let dataset_id = dataset_id(12);
    let dataset_root = hex(13);

    let receipt = registry
        .record_decision_with_root(
            &owner,
            &dataset_id,
            &dataset_root,
            &hex(14),
            &hex(15),
            Decision::NeedsReview,
            1_786_000_100,
        )
        .unwrap();

    assert_eq!(receipt.dataset_id, dataset_id);
    assert_eq!(receipt.dataset_root, dataset_root);
    assert_eq!(receipt.decision, Decision::NeedsReview);
    assert_eq!(registry.receipts().len(), 1);
    assert_eq!(
        registry.record_decision_with_root(
            &attacker,
            &dataset_id,
            &dataset_root,
            &hex(14),
            &hex(15),
            Decision::NeedsReview,
            1_786_000_101,
        ),
        Err(RegistryError::Unauthorized)
    );
    let repeated = registry
        .record_decision_with_root(
            &owner,
            &dataset_id,
            &dataset_root,
            &hex(14),
            &hex(15),
            Decision::NeedsReview,
            1_786_000_999,
        )
        .unwrap();
    assert_eq!(repeated, receipt);
    assert_eq!(registry.receipts().len(), 1);
    assert_eq!(
        registry.record_decision_with_root(
            &owner,
            &dataset_id,
            &dataset_root,
            &hex(14),
            &hex(16),
            Decision::NeedsReview,
            1_786_001_000,
        ),
        Err(RegistryError::DecisionConflict)
    );
}

#[test]
fn only_the_configured_recorder_can_append_purchase_receipts() {
    let owner = account(20);
    let recorder = account(21);
    let attacker = account(22);
    let mut registry = AgentPayRegistry::new(owner, recorder.clone());
    let input = receipt_anchor(23);

    let recorded = registry
        .record_purchase_receipt(&recorder, input.clone(), 1_786_000_200)
        .expect("configured recorder should be authorized");

    assert_eq!(recorded.receipt_hash, input.receipt_hash);
    assert_eq!(recorded.recorder, recorder);
    assert_eq!(recorded.block_time, 1_786_000_200);
    assert_eq!(
        registry.record_purchase_receipt(&attacker, receipt_anchor(24), 1_786_000_201),
        Err(RegistryError::Unauthorized)
    );
}

#[test]
fn purchase_receipt_writes_are_idempotent_but_never_overwritable() {
    let owner = account(30);
    let recorder = account(31);
    let mut registry = AgentPayRegistry::new(owner, recorder.clone());
    let input = receipt_anchor(32);
    let first = registry
        .record_purchase_receipt(&recorder, input.clone(), 1_786_000_300)
        .unwrap();

    let repeated = registry
        .record_purchase_receipt(&recorder, input.clone(), 1_786_000_999)
        .unwrap();
    assert_eq!(repeated, first);

    let conflicting = ReceiptAnchorInput {
        policy_hash: hex(99),
        ..input
    };
    assert_eq!(
        registry.record_purchase_receipt(&recorder, conflicting, 1_786_001_000),
        Err(RegistryError::ReceiptConflict)
    );
}

#[test]
fn owner_can_rotate_the_recorder_and_old_recorder_loses_access() {
    let owner = account(40);
    let old_recorder = account(41);
    let new_recorder = account(42);
    let attacker = account(43);
    let mut registry = AgentPayRegistry::new(owner.clone(), old_recorder.clone());

    assert_eq!(
        registry.rotate_recorder(&attacker, new_recorder.clone()),
        Err(RegistryError::Unauthorized)
    );
    assert_eq!(
        registry.rotate_recorder(&owner, new_recorder.clone()),
        Ok(2)
    );
    assert_eq!(registry.recorder(), &new_recorder);
    assert_eq!(registry.recorder_history().len(), 2);
    assert_eq!(
        registry.record_purchase_receipt(&old_recorder, receipt_anchor(44), 1_786_000_400),
        Err(RegistryError::Unauthorized)
    );
    assert!(registry
        .record_purchase_receipt(&new_recorder, receipt_anchor(44), 1_786_000_400)
        .is_ok());
}

#[test]
fn purchase_receipt_anchor_rejects_noncanonical_hashes() {
    let owner = account(50);
    let recorder = account(51);
    let mut registry = AgentPayRegistry::new(owner, recorder.clone());
    let invalid = ReceiptAnchorInput {
        receipt_hash: "A".repeat(64),
        ..receipt_anchor(52)
    };

    assert_eq!(
        registry.record_purchase_receipt(&recorder, invalid, 1_786_000_500),
        Err(RegistryError::InvalidHash)
    );
}

fn dataset_id(index: u8) -> String {
    format!("dataset-{}", hex(index)[..12].to_string())
}

fn hex(index: u8) -> String {
    format!("{index:02x}").repeat(32)
}

fn account(index: u8) -> String {
    format!("account-hash-{}", hex(index))
}

fn receipt_anchor(index: u8) -> ReceiptAnchorInput {
    ReceiptAnchorInput {
        receipt_hash: hex(index),
        policy_hash: hex(index.wrapping_add(1)),
        settlement_tx_hash: hex(index.wrapping_add(2)),
        outcome: ReceiptOutcome::SettlementMatched,
    }
}
