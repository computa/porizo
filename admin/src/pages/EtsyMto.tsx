import { useCallback, useEffect, useRef, useState } from "react";
import { Link, RefreshCw } from "lucide-react";
import { useApi } from "../hooks/useApi";
import { OrderImport } from "./etsy/OrderImport";
import { OrderDetail } from "./etsy/OrderDetail";
import { isGenerating } from "./etsy/types";
import type { EtsyMtoItem } from "./etsy/types";

export function EtsyMto() {
  const { get, post } = useApi();
  const [items, setItems] = useState<EtsyMtoItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EtsyMtoItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const refreshingRef = useRef(false);
  const requestVersion = useRef(0);
  const mounted = useRef(false);

  const refresh = useCallback(async (force = false) => {
    if (refreshingRef.current && !force) return;
    const version = ++requestVersion.current;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const result = await get<{ items: EtsyMtoItem[] }>("/etsy/mto");
      if (mounted.current && version === requestVersion.current) { setItems(result.items); setError(null); }
    } catch (cause) {
      if (mounted.current && version === requestVersion.current) setError(cause instanceof Error ? cause.message : "Queue refresh failed.");
    } finally {
      if (version === requestVersion.current) {
        refreshingRef.current = false;
        if (mounted.current) setRefreshing(false);
      }
    }
  }, [get]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; };
  }, [refresh]);

  const generating = items.some(isGenerating);
  useEffect(() => {
    if (!generating) return;
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => window.clearInterval(timer);
  }, [generating, refresh]);

  const selected = items.find((item) => item.id === selectedId);
  useEffect(() => {
    let active = true;
    if (selected) {
      get<{ item: EtsyMtoItem }>(`/etsy/mto/${encodeURIComponent(selected.id)}`)
        .then((result) => { if (active) setDetail(result.item); })
        .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Order details could not be loaded."); });
    }
    return () => { active = false; };
  }, [get, selected]);

  async function imported(importedItems: EtsyMtoItem[]) {
    setItems((current) => [...importedItems, ...current.filter((item) => !importedItems.some((added) => added.id === item.id))]);
    setSelectedId(importedItems[0]?.id ?? null);
    await refresh(true);
  }

  async function connectEtsy() {
    setConnecting(true);
    setError(null);
    try {
      const result = await post<{ authorizationUrl: string }>("/etsy/mto/connection/start", {});
      window.location.assign(result.authorizationUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Etsy connection could not start.");
      setConnecting(false);
    }
  }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-white">Etsy made-to-order</h1><p className="text-sm text-slate-400">One paid order JSON → automatic song generation → MP3 → Etsy delivery.</p></div>
      <div className="flex items-center gap-2"><button disabled={connecting} onClick={() => void connectEtsy()} className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 font-medium text-amber-950 disabled:opacity-50"><Link className="h-4 w-4" />{connecting ? "Opening Etsy…" : "Reconnect Etsy"}</button><button disabled={refreshing} onClick={() => void refresh()} className="flex items-center gap-2 rounded-lg bg-slate-700 px-4 py-2 text-white disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />Refresh</button></div>
    </div>
    <OrderImport onImported={imported} />
    {error && <p role="alert" className="rounded bg-rose-950 p-3 text-rose-200">{error}</p>}
    {generating && <p role="status" className="text-sm text-slate-400">Songs are being generated. Progress updates every 5 seconds while this page is open.</p>}
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <section className="overflow-hidden rounded-xl border border-slate-700" aria-label="Order generation queue">
        <h2 className="border-b border-slate-700 p-4 font-semibold text-white">Order queue</h2>
        {items.length === 0 && <p className="p-4 text-slate-400">No imported orders yet.</p>}
        {items.map((item) => <button key={item.id} aria-pressed={selectedId === item.id} onClick={() => setSelectedId(item.id)} className={`block w-full border-b border-slate-800 p-4 text-left hover:bg-slate-800 ${selectedId === item.id ? "bg-slate-800" : ""}`}>
          <p className="font-medium text-white">{item.receipt_id} · {item.transaction_id} · unit {item.ordinal + 1}</p>
          <p className="text-sm text-slate-400">{item.state.replaceAll("_", " ")} · {item.financial_state}</p>
        </button>)}
      </section>
      {detail && detail.id === selectedId && <OrderDetail key={detail.id} item={detail} onUpdated={refresh} />}
      {selected && detail?.id !== selectedId && <p role="status" className="p-4 text-slate-400">Loading order details…</p>}
    </div>
  </div>;
}
