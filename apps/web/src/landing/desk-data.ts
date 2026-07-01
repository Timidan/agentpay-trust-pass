/**
 * One internally consistent settlement run. The same values appear in the
 * hero feed and in the proof-model artifacts so the page reads as a single
 * real run, not as lorem hashes.
 */

export const RUN = {
  runId: "0x2f41",
  quoteId: "qt_7f3da2c81e94b0f6",
  datasetId: "cspr-trade.observations/casper-test/2026-06-12",
  datasetRoot:
    "23553406a529f9a79985a54c63ecd4939eb351a9e10b3037d148739814fbc179",
  amount: "12.5 CSPR",
  amountMotes: "12500000000 motes",
  expiresAt: "2026-06-12T14:09:31Z",
  ttl: "120s",
  network: "casper-test",
  payTo:
    "account-hash-0a28fb30fdfcd4712342503fae80ce5905372ae087c6a96d9119d4b22861a61b",
  agentKey:
    "011cc71b3803e65a6ace281086ba1be1a425375f2ed3ec74ad6780c7fdd9eb17c9",
  nonce: "d6ee0bfd19ebd971",
  signature:
    "01d9530b0126376330356142c77168c5a724b6da734edd82f3b9f68cfc946fd3176934109c7a05c865bf1ff69e496c496e7fa5f47e47a0f0db687afed23b88e1d6",
  reportHash:
    "90ed74544060078af93f174b9fc62a0636e28a827f87e2472e20c6c10c8f4b83",
  receiptHash:
    "9c14bd41f6b7ea487125fe65afd14e4500bb03c950783a10a51a95be9d4df5d9",
  deployHash:
    "f234efa96dfac2a65ca3f9144ebec0dad54c09550e0560a0191743ace9672fb8",
  blockHeight: "#4271086",
  siblings: [
    "617852c7f9e66cfe5ed8f0655c0b8ca0e0dc85f17bdb55592a2a8226afbe8b57",
    "f0dcf77ac4c7ae78cbc39107ed572ab6eb330f1943172340836d8505e84f137d",
    "8d33b5ed465f365bb865fcf1a5c9650ee98d63707853be30930c7a56716c3474",
  ],
  pathNodes: [
    "e89ee7b45c6685e2de46d2e1a14947ebf0fb3662e788432ca2ec4479fc73c223",
    "9d4e51c1fbdeecfeab6c69d24547721ca8a2ccf700f912d42ae65300326bad5f",
  ],
} as const;

export function short(h: string, head = 8, tail = 4): string {
  return `${h.slice(0, head)}…${h.slice(-tail)}`;
}
