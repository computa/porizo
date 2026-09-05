import { useRef, useState } from "react";
import { useApi } from "../../hooks/useApi";
import { Brief } from "./Brief";
import { buttonClass, downloadFile, inputClass, operationHeaders, panelClass } from "./types";
import type { EtsyMtoItem } from "./types";

export function OrderDetail({ item, onUpdated }: { item: EtsyMtoItem; onUpdated: () => Promise<void> }) {
  const { getBlob, post } = useApi();
  const [receipt, setReceipt] = useState("");
  const [evidence, setEvidence] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);

  async function run(operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try { await operation(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Delivery operation failed."); }
    finally { lock.current = false; setBusy(false); }
  }

  async function downloadMp3() {
    const blob = await getBlob(`/etsy/mto/${encodeURIComponent(item.id)}/mp3`);
    downloadFile(blob, `porizo-etsy-${item.receipt_id}-${item.transaction_id}-${item.ordinal}.mp3`);
  }

  async function attest() {
    await post(`/etsy/mto/${encodeURIComponent(item.id)}/attest-completion`, {
      receipt_id: receipt.trim(), acknowledged, evidence_reference: evidence.trim(),
    }, operationHeaders());
    setAcknowledged(false);
    setReceipt("");
    setEvidence("");
    await onUpdated();
  }

  return <section className={panelClass} aria-label={`Order ${item.receipt_id} details`}>
    <h2 className="font-semibold text-white">Order {item.receipt_id} · unit {item.ordinal + 1}</h2>
    <p className="text-sm text-slate-400">Transaction {item.transaction_id} · {item.state.replaceAll("_", " ")} · {item.financial_state}</p>
    <Brief brief={item.brief} />
    {item.last_error && <p role="alert" className="rounded bg-rose-950 p-3 text-rose-200">{item.last_error}</p>}
    {item.state === "needs_attention" && <p className="text-amber-200">Generation needs operator attention. Check the error before retrying; do not create another order to bypass this state.</p>}
    {item.lyrics && <details><summary className="cursor-pointer font-medium">Generated lyrics</summary><p className="mt-3 whitespace-pre-wrap break-words text-sm">{item.lyrics}</p></details>}
    {error && <p role="alert" className="rounded bg-rose-950 p-3 text-rose-200">{error}</p>}
    {item.state === "ready_for_etsy_upload" && <div className="space-y-4 border-t border-slate-700 pt-4">
      <h3 className="font-semibold">2. Download and deliver through Etsy</h3>
      <button disabled={busy} onClick={() => void run(downloadMp3)} className={buttonClass}>Download finished MP3</button>
      <p className="text-sm text-slate-400">Listen to the downloaded MP3, then open the matching Etsy order, choose Complete order, and upload this file. Etsy sends the buyer its download link.</p>
      <a href="https://www.etsy.com/your/orders/sold" target="_blank" rel="noreferrer" className="block text-rose-300 underline">Open Etsy sold orders ↗</a>
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void run(attest); }}>
        <h3 className="font-semibold">3. Record completed Etsy delivery</h3>
        <label className="block text-sm">Retype Etsy order ID to confirm<input required disabled={busy} value={receipt} onChange={(event) => setReceipt(event.target.value)} className={inputClass} /></label>
        <label className="block text-sm">Completion evidence reference<input required disabled={busy} value={evidence} onChange={(event) => setEvidence(event.target.value)} className={inputClass} placeholder="Reference to the Etsy completion confirmation" /></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy} checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1" />I uploaded this song to the matching order and completed it in Etsy. This button only records that action in Porizo.</label>
        <button disabled={busy || !acknowledged || receipt.trim() !== item.receipt_id || !evidence.trim()} className={buttonClass}>Record Etsy completion</button>
      </form>
    </div>}
  </section>;
}
