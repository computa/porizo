export type EtsyBrief = {
  recipient_name: string;
  relationship: string;
  occasion: string;
  style: string;
  specific_memory: string;
};

export type EtsyMtoItem = {
  id: string;
  receipt_id: string;
  transaction_id: string;
  ordinal: number;
  listing_id: string;
  state: string;
  financial_state: string;
  brief_json: string;
  brief: EtsyBrief;
  last_error?: string | null;
  lyrics?: string | null;
};

export type EtsyImportPreview = {
  order: { schema_version: 1; exported_at: string; shop_id: string; receipt_id: string };
  units: Array<{
    identity: { shopId: string; receiptId: string; transactionId: string; listingId: string; ordinal: number };
    brief: EtsyBrief;
    status: "new" | "existing";
  }>;
};

export const inputClass = "mt-1 w-full rounded border border-slate-600 bg-slate-800 p-2 text-white";
export const buttonClass = "rounded bg-rose-600 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50";
export const panelClass = "space-y-4 rounded-xl border border-slate-700 bg-slate-900 p-5 text-slate-200";

export function operationHeaders() {
  return { "Idempotency-Key": crypto.randomUUID() };
}

export function downloadFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function isGenerating(item: EtsyMtoItem) {
  return ["received", "verified_paid", "lyrics_review", "rendering"].includes(item.state);
}
