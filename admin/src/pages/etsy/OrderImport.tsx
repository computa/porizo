import { useRef, useState } from "react";
import { useApi } from "../../hooks/useApi";
import { Brief } from "./Brief";
import { buttonClass, downloadFile, inputClass, operationHeaders, panelClass } from "./types";
import type { EtsyImportPreview, EtsyMtoItem } from "./types";

export function OrderImport({ onImported }: { onImported: (items: EtsyMtoItem[]) => Promise<void> }) {
  const { getBlob, post } = useApi();
  const [receipt, setReceipt] = useState("");
  const [file, setFile] = useState("");
  const [preview, setPreview] = useState<EtsyImportPreview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const lock = useRef(false);

  async function run(operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setNotice("");
    try { await operation(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Order operation failed."); }
    finally { lock.current = false; setBusy(false); }
  }

  async function exportOrder() {
    if (!/^\d+$/.test(receipt.trim())) throw new Error("Enter the numeric Etsy order (receipt) ID.");
    const blob = await getBlob(`/etsy/mto/export/${encodeURIComponent(receipt.trim())}`);
    downloadFile(blob, `etsy-order-${receipt.trim()}.json`);
    setNotice("Order JSON downloaded. Upload it below to review and generate.");
  }

  async function readOrder(selected: File) {
    setPreview(null);
    setFile("");
    setAcknowledged(false);
    if (!selected.name.toLowerCase().endsWith(".json")) throw new Error("Choose a per-order JSON file, not a sales CSV.");
    if (selected.size > 128 * 1024) throw new Error("The order JSON must be no larger than 128 KiB.");
    const contents = await selected.text();
    const result = await post<EtsyImportPreview>("/etsy/mto/import/preview", { file: contents });
    setFile(contents);
    setPreview(result);
  }

  async function importOrder() {
    if (!preview || !acknowledged) return;
    const result = await post<{ items: EtsyMtoItem[] }>("/etsy/mto/import", { file, acknowledged: true }, operationHeaders());
    setPreview(null);
    setFile("");
    setAcknowledged(false);
    setNotice("Order accepted. Generation runs on the server; you can safely leave this page.");
    await onImported(result.items);
  }

  return <section className={panelClass} aria-label="Import Etsy order">
    <h2 className="text-lg font-semibold text-white">1. Export and upload one paid order</h2>
    <p className="text-sm text-slate-400">Export reads the order from the connected Etsy shop. This is a per-order JSON file, not Etsy's sales CSV. Import rechecks payment and prevents duplicate generation.</p>
    <form onSubmit={(event) => { event.preventDefault(); void run(exportOrder); }} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="flex-1 text-sm">Etsy order (receipt) ID<input required inputMode="numeric" pattern="[0-9]+" value={receipt} onChange={(event) => setReceipt(event.target.value)} className={inputClass} disabled={busy} /></label>
      <button disabled={busy} className={buttonClass}>Download order JSON</button>
    </form>
    <label className="block text-sm">Upload order JSON (maximum 128 KiB)
      <input type="file" accept=".json,application/json" disabled={busy} className={inputClass} onChange={(event) => {
        const selected = event.target.files?.[0];
        event.target.value = "";
        if (selected) void run(() => readOrder(selected));
      }} />
    </label>
    {error && <p role="alert" className="rounded bg-rose-950 p-3 text-rose-200">{error}</p>}
    {notice && <p role="status" className="text-emerald-300">{notice}</p>}
    {busy && <p role="status" className="text-sm text-slate-400">Working…</p>}
    {preview && <div className="space-y-4">
      <h3 className="font-semibold">Review order {preview.order.receipt_id}</h3>
      {preview.units.map((unit) => <article key={`${unit.identity.transactionId}-${unit.identity.ordinal}`} className="space-y-3 rounded border border-slate-700 p-4">
        <p className="text-sm text-slate-400">Item {unit.identity.transactionId} · unit {unit.identity.ordinal + 1} · {unit.status === "existing" ? "Already imported — no duplicate generation" : "New song"}</p>
        <Brief brief={unit.brief} />
      </article>)}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1" />I have reviewed these details and authorize paid song generation for new units. Lyrics and the MP3 will be generated automatically.</label>
      <button type="button" disabled={busy || !acknowledged} onClick={() => void run(importOrder)} className={buttonClass}>Import and generate songs</button>
    </div>}
  </section>;
}
