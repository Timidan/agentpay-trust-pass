use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Decision {
    Approved,
    Rejected,
    NeedsReview,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DecisionReceipt {
    pub dataset_id: String,
    pub dataset_root: String,
    pub report_hash: String,
    pub payment_receipt_hash: String,
    pub decision: Decision,
    pub timestamp: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReceiptOutcome {
    SettlementMatched,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReceiptAnchorInput {
    pub receipt_hash: String,
    pub policy_hash: String,
    pub settlement_tx_hash: String,
    pub outcome: ReceiptOutcome,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PurchaseReceiptAnchor {
    pub receipt_hash: String,
    pub policy_hash: String,
    pub settlement_tx_hash: String,
    pub outcome: ReceiptOutcome,
    pub recorder: String,
    pub block_time: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecorderRotation {
    pub revision: u64,
    pub recorder: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RegistryError {
    Unauthorized,
    InvalidHash,
    InvalidDatasetId,
    DecisionConflict,
    ReceiptConflict,
    InvalidAccount,
}

pub struct AgentPayRegistry {
    dataset_roots: HashMap<String, String>,
    receipts: Vec<DecisionReceipt>,
    owner: String,
    recorder: String,
    purchase_receipts: HashMap<String, PurchaseReceiptAnchor>,
    recorder_history: Vec<RecorderRotation>,
}

impl AgentPayRegistry {
    pub fn new(owner: impl Into<String>, recorder: impl Into<String>) -> Self {
        let owner = owner.into();
        let recorder = recorder.into();
        assert!(is_account_hash(&owner), "invalid owner account hash");
        assert!(is_account_hash(&recorder), "invalid recorder account hash");
        Self {
            dataset_roots: HashMap::new(),
            receipts: Vec::new(),
            owner,
            recorder: recorder.clone(),
            purchase_receipts: HashMap::new(),
            recorder_history: vec![RecorderRotation {
                revision: 1,
                recorder,
            }],
        }
    }

    pub fn record_decision_with_root(
        &mut self,
        caller: &str,
        dataset_id: impl Into<String>,
        dataset_root: impl Into<String>,
        report_hash: impl Into<String>,
        payment_receipt_hash: impl Into<String>,
        decision: Decision,
        timestamp: u64,
    ) -> Result<DecisionReceipt, RegistryError> {
        if caller != self.owner && caller != self.recorder {
            return Err(RegistryError::Unauthorized);
        }
        let dataset_id = dataset_id.into();
        let dataset_root = dataset_root.into();
        let report_hash = report_hash.into();
        let payment_receipt_hash = payment_receipt_hash.into();
        if !is_dataset_id(&dataset_id) {
            return Err(RegistryError::InvalidDatasetId);
        }
        if !is_hash(&dataset_root) || !is_hash(&report_hash) || !is_hash(&payment_receipt_hash) {
            return Err(RegistryError::InvalidHash);
        }
        if self
            .dataset_roots
            .get(&dataset_id)
            .is_some_and(|existing| existing != &dataset_root)
        {
            return Err(RegistryError::DecisionConflict);
        }
        if let Some(existing) = self
            .receipts
            .iter()
            .find(|receipt| receipt.dataset_id == dataset_id && receipt.report_hash == report_hash)
        {
            if existing.dataset_root == dataset_root
                && existing.payment_receipt_hash == payment_receipt_hash
                && existing.decision == decision
            {
                return Ok(existing.clone());
            }
            return Err(RegistryError::DecisionConflict);
        }

        let receipt = DecisionReceipt {
            dataset_id: dataset_id.clone(),
            dataset_root: dataset_root.clone(),
            report_hash,
            payment_receipt_hash,
            decision,
            timestamp,
        };

        self.dataset_roots.insert(dataset_id, dataset_root);
        self.receipts.push(receipt.clone());
        Ok(receipt)
    }

    pub fn receipts(&self) -> &[DecisionReceipt] {
        &self.receipts
    }

    pub fn record_purchase_receipt(
        &mut self,
        caller: &str,
        input: ReceiptAnchorInput,
        block_time: u64,
    ) -> Result<PurchaseReceiptAnchor, RegistryError> {
        if caller != self.recorder {
            return Err(RegistryError::Unauthorized);
        }
        if !is_hash(&input.receipt_hash)
            || !is_hash(&input.policy_hash)
            || !is_hash(&input.settlement_tx_hash)
        {
            return Err(RegistryError::InvalidHash);
        }

        if let Some(existing) = self.purchase_receipts.get(&input.receipt_hash) {
            if existing.policy_hash == input.policy_hash
                && existing.settlement_tx_hash == input.settlement_tx_hash
                && existing.outcome == input.outcome
            {
                return Ok(existing.clone());
            }
            return Err(RegistryError::ReceiptConflict);
        }

        let anchor = PurchaseReceiptAnchor {
            receipt_hash: input.receipt_hash.clone(),
            policy_hash: input.policy_hash,
            settlement_tx_hash: input.settlement_tx_hash,
            outcome: input.outcome,
            recorder: self.recorder.clone(),
            block_time,
        };
        self.purchase_receipts
            .insert(input.receipt_hash, anchor.clone());
        Ok(anchor)
    }

    pub fn rotate_recorder(
        &mut self,
        caller: &str,
        recorder: impl Into<String>,
    ) -> Result<u64, RegistryError> {
        if caller != self.owner {
            return Err(RegistryError::Unauthorized);
        }
        let recorder = recorder.into();
        if !is_account_hash(&recorder) {
            return Err(RegistryError::InvalidAccount);
        }
        if recorder == self.recorder {
            return Ok(self.recorder_history.len() as u64);
        }
        let revision = self.recorder_history.len() as u64 + 1;
        self.recorder = recorder.clone();
        self.recorder_history
            .push(RecorderRotation { revision, recorder });
        Ok(revision)
    }

    pub fn recorder(&self) -> &str {
        &self.recorder
    }

    pub fn recorder_history(&self) -> &[RecorderRotation] {
        &self.recorder_history
    }
}

fn is_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_account_hash(value: &str) -> bool {
    value
        .strip_prefix("account-hash-")
        .map(is_hash)
        .unwrap_or(false)
}

fn is_dataset_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}
