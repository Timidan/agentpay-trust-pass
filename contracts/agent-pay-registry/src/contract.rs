#![no_std]
#![no_main]
#![feature(alloc_error_handler)]

extern crate alloc;

use alloc::{
    format,
    string::{String, ToString},
    vec,
};
use core::{alloc::Layout, panic::PanicInfo};
use casper_contract::{
    contract_api::{runtime, storage},
    unwrap_or_revert::UnwrapOrRevert,
};
use casper_types::{
    api_error::ApiError,
    contracts::{EntryPoint, EntryPoints, NamedKeys},
    CLType, CLValue, EntryPointAccess, EntryPointType, Key, Parameter,
};

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

const CONTRACT_PACKAGE_NAME: &str = "agentpay_registry_package";
const CONTRACT_ACCESS_UREF: &str = "agentpay_registry_access";
const CONTRACT_KEY: &str = "agentpay_registry";
const CONTRACT_VERSION_KEY: &str = "agentpay_registry_version";

const ENTRY_RECORD_DECISION_WITH_ROOT: &str = "record_decision_with_root";
const ENTRY_GET_DATASET_ROOT: &str = "get_dataset_root";

const DATASET_ROOTS: &str = "dataset_roots";
const DECISION_RECEIPTS: &str = "decision_receipts";

const ARG_DATASET_ID: &str = "dataset_id";
const ARG_DATASET_ROOT: &str = "dataset_root";
const ARG_REPORT_HASH: &str = "report_hash";
const ARG_PAYMENT_RECEIPT_HASH: &str = "payment_receipt_hash";
const ARG_DECISION: &str = "decision";

#[no_mangle]
pub extern "C" fn record_decision_with_root() {
    let dataset_id: String = runtime::get_named_arg(ARG_DATASET_ID);
    let dataset_root: String = runtime::get_named_arg(ARG_DATASET_ROOT);
    let report_hash: String = runtime::get_named_arg(ARG_REPORT_HASH);
    let payment_receipt_hash: String = runtime::get_named_arg(ARG_PAYMENT_RECEIPT_HASH);
    let decision: String = runtime::get_named_arg(ARG_DECISION);

    if !is_valid_decision(&decision) {
        runtime::revert(ApiError::InvalidArgument);
    }

    storage::named_dictionary_put(DATASET_ROOTS, &dataset_id, dataset_root.clone());
    storage::named_dictionary_put(
        DECISION_RECEIPTS,
        &receipt_key(&dataset_id, &report_hash),
        receipt_value(
            &dataset_id,
            &dataset_root,
            &report_hash,
            &payment_receipt_hash,
            &decision,
        ),
    );
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
pub extern "C" fn call() {
    let dataset_roots = storage::new_dictionary(DATASET_ROOTS).unwrap_or_revert();
    let decision_receipts = storage::new_dictionary(DECISION_RECEIPTS).unwrap_or_revert();

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

    let mut named_keys = NamedKeys::new();
    named_keys.insert(DATASET_ROOTS.to_string(), Key::from(dataset_roots));
    named_keys.insert(DECISION_RECEIPTS.to_string(), Key::from(decision_receipts));

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
