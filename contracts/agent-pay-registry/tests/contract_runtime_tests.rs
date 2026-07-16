use std::path::PathBuf;

use casper_engine_test_support::{
    ExecuteRequestBuilder, LmdbWasmTestBuilder, DEFAULT_ACCOUNTS, DEFAULT_ACCOUNT_ADDR,
    DEFAULT_PROPOSER_ADDR, LOCAL_GENESIS_REQUEST,
};
use casper_types::{
    account::AccountHash, addressable_entity::AddressableEntityHash, runtime_args, Gas,
    RuntimeArgs,
};

const CONTRACT_KEY: &str = "agentpay_registry_v2";
const PURCHASE_RECEIPTS: &str = "agentpay_registry_v2_purchase_receipts";
const INSTALL_PAYMENT_CEILING: u64 = 150_000_000_000;

#[test]
fn legacy_decisions_are_authorized_idempotent_and_append_only() {
    let mut fixture = ContractFixture::install();
    let args = decision_args("runtime-dataset", 1, "approved");

    fixture.expect_failure(fixture.attacker, "record_decision_with_root", args.clone());
    fixture.expect_success(fixture.owner, "record_decision_with_root", args.clone());
    fixture.expect_success(fixture.owner, "record_decision_with_root", args.clone());
    fixture.expect_failure(
        fixture.owner,
        "record_decision_with_root",
        decision_args("runtime-dataset", 1, "rejected"),
    );
    fixture.expect_failure(
        fixture.owner,
        "record_decision_with_root",
        decision_args("invalid\"dataset", 7, "approved"),
    );
    fixture.expect_failure(
        fixture.owner,
        "record_decision_with_root",
        runtime_args! {
            "dataset_id" => "invalid-hash".to_string(),
            "dataset_root" => "A".repeat(64),
            "report_hash" => hex(9),
            "payment_receipt_hash" => hex(10),
            "decision" => "approved".to_string(),
        },
    );

    fixture.expect_success(
        fixture.recorder,
        "record_decision_with_root",
        decision_args("recorder-dataset", 5, "needs_review"),
    );
}

#[test]
fn receipt_anchors_reject_unauthorized_and_conflicting_writes() {
    let mut fixture = ContractFixture::install();
    let receipt_hash = hex(20);
    let args = receipt_args(20);

    fixture.expect_failure(fixture.owner, "record_purchase_receipt", args.clone());
    fixture.expect_failure(fixture.attacker, "record_purchase_receipt", args.clone());
    fixture.expect_success(fixture.recorder, "record_purchase_receipt", args.clone());
    fixture.expect_success(fixture.recorder, "record_purchase_receipt", args);
    fixture.expect_failure(
        fixture.recorder,
        "record_purchase_receipt",
        runtime_args! {
            "receipt_hash" => receipt_hash.clone(),
            "policy_hash" => hex(99),
            "settlement_tx_hash" => hex(22),
            "outcome" => "settlement_matched".to_string(),
        },
    );

    let named_keys = fixture
        .builder
        .get_named_keys_for_contract(fixture.contract_hash);
    let dictionary = named_keys
        .get(PURCHASE_RECEIPTS)
        .and_then(|key| key.into_uref())
        .expect("purchase receipt dictionary should exist");
    let stored = fixture
        .builder
        .query_dictionary_item(None, dictionary, &receipt_hash)
        .expect("purchase receipt should be readable")
        .into_cl_value()
        .expect("purchase receipt should be a CLValue")
        .into_t::<String>()
        .expect("purchase receipt should be stored as a string");
    assert!(stored.contains(&format!("\"receiptHash\":\"{receipt_hash}\"")));
    assert!(stored.contains(&format!(
        "\"recorder\":\"{}\"",
        fixture.recorder.to_formatted_string()
    )));
}

#[test]
fn owner_rotation_revokes_the_previous_recorder() {
    let mut fixture = ContractFixture::install();

    fixture.expect_failure(
        fixture.attacker,
        "set_recorder",
        runtime_args! { "recorder" => fixture.attacker },
    );
    fixture.expect_success(
        fixture.owner,
        "set_recorder",
        runtime_args! { "recorder" => fixture.attacker },
    );
    fixture.expect_failure(
        fixture.recorder,
        "record_purchase_receipt",
        receipt_args(30),
    );
    fixture.expect_success(
        fixture.attacker,
        "record_purchase_receipt",
        receipt_args(30),
    );
}

struct ContractFixture {
    builder: LmdbWasmTestBuilder,
    contract_hash: AddressableEntityHash,
    owner: AccountHash,
    recorder: AccountHash,
    attacker: AccountHash,
}

impl ContractFixture {
    fn install() -> Self {
        let owner = *DEFAULT_ACCOUNT_ADDR;
        let recorder = *DEFAULT_PROPOSER_ADDR;
        let attacker = DEFAULT_ACCOUNTS[2].account_hash();
        let mut builder = LmdbWasmTestBuilder::default();
        builder.run_genesis((*LOCAL_GENESIS_REQUEST).clone());
        let install = ExecuteRequestBuilder::standard(
            owner,
            wasm_path().to_str().expect("WASM path should be UTF-8"),
            runtime_args! { "recorder" => recorder },
        )
        .build();
        builder.exec(install).expect_success().commit();
        assert!(
            builder.last_exec_gas_consumed() <= Gas::new(INSTALL_PAYMENT_CEILING),
            "registry install exceeds the configured Testnet payment ceiling"
        );

        let contract_hash = builder
            .get_entity_with_named_keys_by_account_hash(owner)
            .expect("owner account should exist")
            .named_keys()
            .get(CONTRACT_KEY)
            .copied()
            .and_then(|key| key.into_entity_hash())
            .expect("installed contract hash should exist");
        Self {
            builder,
            contract_hash,
            owner,
            recorder,
            attacker,
        }
    }

    fn expect_success(&mut self, caller: AccountHash, entry_point: &str, args: RuntimeArgs) {
        let request = ExecuteRequestBuilder::contract_call_by_hash(
            caller,
            self.contract_hash,
            entry_point,
            args,
        )
        .build();
        self.builder.exec(request).expect_success().commit();
    }

    fn expect_failure(&mut self, caller: AccountHash, entry_point: &str, args: RuntimeArgs) {
        let request = ExecuteRequestBuilder::contract_call_by_hash(
            caller,
            self.contract_hash,
            entry_point,
            args,
        )
        .build();
        self.builder.exec(request).expect_failure();
    }
}

fn decision_args(dataset_id: &str, seed: u8, decision: &str) -> RuntimeArgs {
    runtime_args! {
        "dataset_id" => dataset_id.to_string(),
        "dataset_root" => hex(seed),
        "report_hash" => hex(seed.wrapping_add(1)),
        "payment_receipt_hash" => hex(seed.wrapping_add(2)),
        "decision" => decision.to_string(),
    }
}

fn receipt_args(seed: u8) -> RuntimeArgs {
    runtime_args! {
        "receipt_hash" => hex(seed),
        "policy_hash" => hex(seed.wrapping_add(1)),
        "settlement_tx_hash" => hex(seed.wrapping_add(2)),
        "outcome" => "settlement_matched".to_string(),
    }
}

fn hex(seed: u8) -> String {
    format!("{seed:02x}").repeat(32)
}

fn wasm_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target/wasm32-unknown-unknown/release/agent_pay_registry_contract.wasm")
}
