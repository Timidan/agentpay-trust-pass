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

#[derive(Default)]
pub struct AgentPayRegistry {
    dataset_roots: HashMap<String, String>,
    receipts: Vec<DecisionReceipt>,
}

impl AgentPayRegistry {
    pub fn publish_dataset_root(&mut self, dataset_id: impl Into<String>, root: impl Into<String>) {
        self.dataset_roots.insert(dataset_id.into(), root.into());
    }

    pub fn record_decision(
        &mut self,
        dataset_id: impl Into<String>,
        report_hash: impl Into<String>,
        payment_receipt_hash: impl Into<String>,
        decision: Decision,
        timestamp: u64,
    ) -> DecisionReceipt {
        let dataset_id = dataset_id.into();
        let dataset_root = self
            .dataset_roots
            .get(&dataset_id)
            .unwrap_or_else(|| panic!("unknown dataset: {dataset_id}"))
            .clone();

        let receipt = DecisionReceipt {
            dataset_id,
            dataset_root,
            report_hash: report_hash.into(),
            payment_receipt_hash: payment_receipt_hash.into(),
            decision,
            timestamp,
        };

        self.receipts.push(receipt.clone());
        receipt
    }

    pub fn record_decision_with_root(
        &mut self,
        dataset_id: impl Into<String>,
        dataset_root: impl Into<String>,
        report_hash: impl Into<String>,
        payment_receipt_hash: impl Into<String>,
        decision: Decision,
        timestamp: u64,
    ) -> DecisionReceipt {
        let dataset_id = dataset_id.into();
        let dataset_root = dataset_root.into();
        self.dataset_roots.insert(dataset_id.clone(), dataset_root.clone());

        let receipt = DecisionReceipt {
            dataset_id,
            dataset_root,
            report_hash: report_hash.into(),
            payment_receipt_hash: payment_receipt_hash.into(),
            decision,
            timestamp,
        };

        self.receipts.push(receipt.clone());
        receipt
    }

    pub fn receipts(&self) -> &[DecisionReceipt] {
        &self.receipts
    }
}
