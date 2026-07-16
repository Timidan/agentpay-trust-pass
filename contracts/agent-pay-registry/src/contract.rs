#![no_std]
#![no_main]
#![feature(alloc_error_handler)]

extern crate alloc;

use alloc::{
    format,
    string::{String, ToString},
    vec,
};
use casper_contract::{
    contract_api::{runtime, storage},
    unwrap_or_revert::UnwrapOrRevert,
};
use casper_types::{
    account::AccountHash,
    api_error::ApiError,
    contracts::{EntryPoint, EntryPoints, NamedKeys},
    CLType, CLTyped, CLValue, EntryPointAccess, EntryPointType, Key, Parameter,
};
use core::{alloc::Layout, panic::PanicInfo};

#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

#[alloc_error_handler]
fn alloc_error(_layout: Layout) -> ! {
    loop {}
}

const CONTRACT_PACKAGE_NAME: &str = "agentpay_registry_v2_package";
const CONTRACT_ACCESS_UREF: &str = "agentpay_registry_v2_access";
const CONTRACT_KEY: &str = "agentpay_registry_v2";
const CONTRACT_VERSION_KEY: &str = "agentpay_registry_v2_version";

const ENTRY_RECORD_DECISION_WITH_ROOT: &str = "record_decision_with_root";
const ENTRY_GET_DATASET_ROOT: &str = "get_dataset_root";
const ENTRY_RECORD_PURCHASE_RECEIPT: &str = "record_purchase_receipt";
const ENTRY_GET_PURCHASE_RECEIPT: &str = "get_purchase_receipt";
const ENTRY_SET_RECORDER: &str = "set_recorder";
const ENTRY_GET_RECORDER: &str = "get_recorder";
const ENTRY_GET_OWNER: &str = "get_owner";

const DATASET_ROOTS: &str = "agentpay_registry_v2_dataset_roots";
const DECISION_RECEIPTS: &str = "agentpay_registry_v2_decision_receipts";
const PURCHASE_RECEIPTS: &str = "agentpay_registry_v2_purchase_receipts";
const PURCHASE_RECEIPT_BINDINGS: &str = "agentpay_registry_v2_purchase_receipt_bindings";
const RECORDER_HISTORY: &str = "agentpay_registry_v2_recorder_history";
const OWNER: &str = "owner";
const RECORDER: &str = "recorder";
const RECORDER_REVISION: &str = "recorder_revision";

const ARG_DATASET_ID: &str = "dataset_id";
const ARG_DATASET_ROOT: &str = "dataset_root";
const ARG_REPORT_HASH: &str = "report_hash";
const ARG_PAYMENT_RECEIPT_HASH: &str = "payment_receipt_hash";
const ARG_DECISION: &str = "decision";
const ARG_RECEIPT_HASH: &str = "receipt_hash";
const ARG_POLICY_HASH: &str = "policy_hash";
const ARG_SETTLEMENT_TX_HASH: &str = "settlement_tx_hash";
const ARG_OUTCOME: &str = "outcome";
const ARG_RECORDER: &str = "recorder";

const OUTCOME_SETTLEMENT_MATCHED: &str = "settlement_matched";
const CALLER_ACCOUNT_FIELD: u8 = 0;

#[derive(Clone, Copy)]
#[repr(u16)]
enum RegistryContractError {
    Unauthorized = 100,
    InvalidHash = 101,
    InvalidOutcome = 102,
    ReceiptConflict = 103,
    MissingNamedKey = 104,
    InvalidNamedKey = 105,
    InvalidCaller = 106,
    InvalidRecorder = 107,
    InvalidDatasetId = 108,
}

impl From<RegistryContractError> for ApiError {
    fn from(value: RegistryContractError) -> Self {
        ApiError::User(value as u16)
    }
}

#[no_mangle]
pub extern "C" fn record_decision_with_root() {
    let caller = immediate_account_hash();
    if caller != read_account_hash(OWNER) && caller != read_account_hash(RECORDER) {
        runtime::revert(RegistryContractError::Unauthorized);
    }

    let dataset_id: String = runtime::get_named_arg(ARG_DATASET_ID);
    let dataset_root: String = runtime::get_named_arg(ARG_DATASET_ROOT);
    let report_hash: String = runtime::get_named_arg(ARG_REPORT_HASH);
    let payment_receipt_hash: String = runtime::get_named_arg(ARG_PAYMENT_RECEIPT_HASH);
    let decision: String = runtime::get_named_arg(ARG_DECISION);

    if !is_valid_dataset_id(&dataset_id) {
        runtime::revert(RegistryContractError::InvalidDatasetId);
    }
    if !is_lower_hex_64(&dataset_root)
        || !is_lower_hex_64(&report_hash)
        || !is_lower_hex_64(&payment_receipt_hash)
    {
        runtime::revert(RegistryContractError::InvalidHash);
    }
    if !is_valid_decision(&decision) {
        runtime::revert(ApiError::InvalidArgument);
    }

    let key = receipt_key(&dataset_id, &report_hash);
    let value = receipt_value(
        &dataset_id,
        &dataset_root,
        &report_hash,
        &payment_receipt_hash,
        &decision,
    );
    let existing_root =
        storage::named_dictionary_get::<String>(DATASET_ROOTS, &dataset_id).unwrap_or_revert();
    if existing_root
        .as_ref()
        .is_some_and(|existing| existing != &dataset_root)
    {
        runtime::revert(RegistryContractError::ReceiptConflict);
    }
    match storage::named_dictionary_get::<String>(DECISION_RECEIPTS, &key).unwrap_or_revert() {
        Some(existing) if existing == value && existing_root.as_ref() == Some(&dataset_root) => {
            return;
        }
        Some(_) => runtime::revert(RegistryContractError::ReceiptConflict),
        None => {}
    }

    storage::named_dictionary_put(DATASET_ROOTS, &dataset_id, dataset_root);
    storage::named_dictionary_put(DECISION_RECEIPTS, &key, value);
}

#[no_mangle]
pub extern "C" fn get_dataset_root() {
    let dataset_id: String = runtime::get_named_arg(ARG_DATASET_ID);
    let root = storage::named_dictionary_get::<String>(DATASET_ROOTS, &dataset_id)
        .unwrap_or_revert()
        .unwrap_or_default();
    runtime::ret(CLValue::from_t(root).unwrap_or_revert());
}

#[no_mangle]
pub extern "C" fn record_purchase_receipt() {
    let caller = immediate_account_hash();
    if caller != read_account_hash(RECORDER) {
        runtime::revert(RegistryContractError::Unauthorized);
    }

    let receipt_hash: String = runtime::get_named_arg(ARG_RECEIPT_HASH);
    let policy_hash: String = runtime::get_named_arg(ARG_POLICY_HASH);
    let settlement_tx_hash: String = runtime::get_named_arg(ARG_SETTLEMENT_TX_HASH);
    let outcome: String = runtime::get_named_arg(ARG_OUTCOME);
    if !is_lower_hex_64(&receipt_hash)
        || !is_lower_hex_64(&policy_hash)
        || !is_lower_hex_64(&settlement_tx_hash)
    {
        runtime::revert(RegistryContractError::InvalidHash);
    }
    if outcome != OUTCOME_SETTLEMENT_MATCHED {
        runtime::revert(RegistryContractError::InvalidOutcome);
    }

    let binding = receipt_binding(&policy_hash, &settlement_tx_hash, &outcome);
    match storage::named_dictionary_get::<String>(PURCHASE_RECEIPT_BINDINGS, &receipt_hash)
        .unwrap_or_revert()
    {
        Some(existing) if existing == binding => return,
        Some(_) => runtime::revert(RegistryContractError::ReceiptConflict),
        None => {}
    }

    let block_time = runtime::get_blocktime().value();
    storage::named_dictionary_put(
        PURCHASE_RECEIPTS,
        &receipt_hash,
        purchase_receipt_value(
            &receipt_hash,
            &policy_hash,
            &settlement_tx_hash,
            &outcome,
            caller,
            block_time,
        ),
    );
    storage::named_dictionary_put(PURCHASE_RECEIPT_BINDINGS, &receipt_hash, binding);
}

#[no_mangle]
pub extern "C" fn get_purchase_receipt() {
    let receipt_hash: String = runtime::get_named_arg(ARG_RECEIPT_HASH);
    if !is_lower_hex_64(&receipt_hash) {
        runtime::revert(RegistryContractError::InvalidHash);
    }
    let anchor = storage::named_dictionary_get::<String>(PURCHASE_RECEIPTS, &receipt_hash)
        .unwrap_or_revert()
        .unwrap_or_default();
    runtime::ret(CLValue::from_t(anchor).unwrap_or_revert());
}

#[no_mangle]
pub extern "C" fn set_recorder() {
    let caller = immediate_account_hash();
    if caller != read_account_hash(OWNER) {
        runtime::revert(RegistryContractError::Unauthorized);
    }
    let recorder: AccountHash = runtime::get_named_arg(ARG_RECORDER);
    if recorder == AccountHash::new([0; 32]) {
        runtime::revert(RegistryContractError::InvalidRecorder);
    }
    if recorder == read_account_hash(RECORDER) {
        return;
    }

    let revision = read_u64(RECORDER_REVISION)
        .checked_add(1)
        .unwrap_or_revert_with(ApiError::OutOfMemory);
    write_named_uref(RECORDER, recorder);
    write_named_uref(RECORDER_REVISION, revision);
    storage::named_dictionary_put(
        RECORDER_HISTORY,
        &revision.to_string(),
        recorder_rotation_value(revision, recorder, runtime::get_blocktime().value()),
    );
}

#[no_mangle]
pub extern "C" fn get_recorder() {
    runtime::ret(CLValue::from_t(read_account_hash(RECORDER)).unwrap_or_revert());
}

#[no_mangle]
pub extern "C" fn get_owner() {
    runtime::ret(CLValue::from_t(read_account_hash(OWNER)).unwrap_or_revert());
}

#[no_mangle]
pub extern "C" fn call() {
    let owner = runtime::get_caller();
    let recorder: AccountHash = runtime::get_named_arg(ARG_RECORDER);
    if recorder == AccountHash::new([0; 32]) {
        runtime::revert(RegistryContractError::InvalidRecorder);
    }
    let dataset_roots = storage::new_dictionary(DATASET_ROOTS).unwrap_or_revert();
    let decision_receipts = storage::new_dictionary(DECISION_RECEIPTS).unwrap_or_revert();
    let purchase_receipts = storage::new_dictionary(PURCHASE_RECEIPTS).unwrap_or_revert();
    let purchase_receipt_bindings =
        storage::new_dictionary(PURCHASE_RECEIPT_BINDINGS).unwrap_or_revert();
    let recorder_history = storage::new_dictionary(RECORDER_HISTORY).unwrap_or_revert();
    storage::dictionary_put(
        recorder_history,
        "1",
        recorder_rotation_value(1, recorder, runtime::get_blocktime().value()),
    );

    let mut entry_points = EntryPoints::new();
    entry_points.add_entry_point(EntryPoint::new(
        ENTRY_RECORD_DECISION_WITH_ROOT,
        vec![
            Parameter::new(ARG_DATASET_ID, CLType::String),
            Parameter::new(ARG_DATASET_ROOT, CLType::String),
            Parameter::new(ARG_REPORT_HASH, CLType::String),
            Parameter::new(ARG_PAYMENT_RECEIPT_HASH, CLType::String),
            Parameter::new(ARG_DECISION, CLType::String),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
    ));
    entry_points.add_entry_point(EntryPoint::new(
        ENTRY_GET_DATASET_ROOT,
        vec![Parameter::new(ARG_DATASET_ID, CLType::String)],
        CLType::String,
        EntryPointAccess::Public,
        EntryPointType::Called,
    ));
    entry_points.add_entry_point(EntryPoint::new(
        ENTRY_RECORD_PURCHASE_RECEIPT,
        vec![
            Parameter::new(ARG_RECEIPT_HASH, CLType::String),
            Parameter::new(ARG_POLICY_HASH, CLType::String),
            Parameter::new(ARG_SETTLEMENT_TX_HASH, CLType::String),
            Parameter::new(ARG_OUTCOME, CLType::String),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
    ));
    entry_points.add_entry_point(EntryPoint::new(
        ENTRY_GET_PURCHASE_RECEIPT,
        vec![Parameter::new(ARG_RECEIPT_HASH, CLType::String)],
        CLType::String,
        EntryPointAccess::Public,
        EntryPointType::Called,
    ));
    entry_points.add_entry_point(EntryPoint::new(
        ENTRY_SET_RECORDER,
        vec![Parameter::new(ARG_RECORDER, AccountHash::cl_type())],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
    ));
    entry_points.add_entry_point(EntryPoint::new(
        ENTRY_GET_RECORDER,
        vec![],
        AccountHash::cl_type(),
        EntryPointAccess::Public,
        EntryPointType::Called,
    ));
    entry_points.add_entry_point(EntryPoint::new(
        ENTRY_GET_OWNER,
        vec![],
        AccountHash::cl_type(),
        EntryPointAccess::Public,
        EntryPointType::Called,
    ));

    let mut named_keys = NamedKeys::new();
    named_keys.insert(DATASET_ROOTS.to_string(), Key::from(dataset_roots));
    named_keys.insert(DECISION_RECEIPTS.to_string(), Key::from(decision_receipts));
    named_keys.insert(PURCHASE_RECEIPTS.to_string(), Key::from(purchase_receipts));
    named_keys.insert(
        PURCHASE_RECEIPT_BINDINGS.to_string(),
        Key::from(purchase_receipt_bindings),
    );
    named_keys.insert(RECORDER_HISTORY.to_string(), Key::from(recorder_history));
    named_keys.insert(OWNER.to_string(), storage::new_uref(owner).into());
    named_keys.insert(RECORDER.to_string(), storage::new_uref(recorder).into());
    named_keys.insert(
        RECORDER_REVISION.to_string(),
        storage::new_uref(1_u64).into(),
    );

    let (stored_contract_hash, contract_version) = storage::new_contract(
        entry_points.into(),
        Some(named_keys),
        Some(CONTRACT_PACKAGE_NAME.to_string()),
        Some(CONTRACT_ACCESS_UREF.to_string()),
        None,
    );
    runtime::put_key(CONTRACT_KEY, stored_contract_hash.into());
    runtime::put_key(
        CONTRACT_VERSION_KEY,
        storage::new_uref(contract_version).into(),
    );
}

fn is_valid_decision(decision: &str) -> bool {
    matches!(decision, "approved" | "rejected" | "needs_review")
}

fn is_valid_dataset_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

fn receipt_key(dataset_id: &str, report_hash: &str) -> String {
    format!("{dataset_id}:{report_hash}")
}

fn receipt_value(
    dataset_id: &str,
    dataset_root: &str,
    report_hash: &str,
    payment_receipt_hash: &str,
    decision: &str,
) -> String {
    format!(
        "{{\"datasetId\":\"{dataset_id}\",\"datasetRoot\":\"{dataset_root}\",\"reportHash\":\"{report_hash}\",\"paymentReceiptHash\":\"{payment_receipt_hash}\",\"decision\":\"{decision}\"}}"
    )
}

fn immediate_account_hash() -> AccountHash {
    runtime::get_immediate_caller()
        .unwrap_or_revert_with(RegistryContractError::InvalidCaller)
        .get_field_by_index(CALLER_ACCOUNT_FIELD)
        .cloned()
        .and_then(|value| value.into_t::<Option<AccountHash>>().ok())
        .flatten()
        .unwrap_or_revert_with(RegistryContractError::InvalidCaller)
}

fn read_account_hash(name: &str) -> AccountHash {
    read_named_uref(name)
}

fn read_u64(name: &str) -> u64 {
    read_named_uref(name)
}

fn read_named_uref<T: casper_types::bytesrepr::FromBytes + CLTyped>(name: &str) -> T {
    let key = runtime::get_key(name).unwrap_or_revert_with(RegistryContractError::MissingNamedKey);
    let uref = *key
        .as_uref()
        .unwrap_or_revert_with(RegistryContractError::InvalidNamedKey);
    storage::read(uref)
        .unwrap_or_revert()
        .unwrap_or_revert_with(RegistryContractError::MissingNamedKey)
}

fn write_named_uref<T: casper_types::bytesrepr::ToBytes + CLTyped>(name: &str, value: T) {
    let key = runtime::get_key(name).unwrap_or_revert_with(RegistryContractError::MissingNamedKey);
    let uref = *key
        .as_uref()
        .unwrap_or_revert_with(RegistryContractError::InvalidNamedKey);
    storage::write(uref, value);
}

fn is_lower_hex_64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn receipt_binding(policy_hash: &str, settlement_tx_hash: &str, outcome: &str) -> String {
    format!("{policy_hash}:{settlement_tx_hash}:{outcome}")
}

fn purchase_receipt_value(
    receipt_hash: &str,
    policy_hash: &str,
    settlement_tx_hash: &str,
    outcome: &str,
    recorder: AccountHash,
    block_time: u64,
) -> String {
    format!(
        "{{\"schemaVersion\":\"agentpay-anchor/v1\",\"receiptHash\":\"{receipt_hash}\",\"policyHash\":\"{policy_hash}\",\"settlementTransactionHash\":\"{settlement_tx_hash}\",\"outcome\":\"{outcome}\",\"recorder\":\"{}\",\"blockTime\":{block_time}}}",
        recorder.to_formatted_string()
    )
}

fn recorder_rotation_value(revision: u64, recorder: AccountHash, block_time: u64) -> String {
    format!(
        "{{\"revision\":{revision},\"recorder\":\"{}\",\"blockTime\":{block_time}}}",
        recorder.to_formatted_string()
    )
}
