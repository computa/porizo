import { CheckIcon } from "../components/Icons";
import type { Product } from "../api/funnel";

interface OfferProps {
  recipient: string;
  product?: Product;
  loading: boolean;
  error?: string;
  cancelled?: boolean;
  previewOnly?: boolean;
  onCheckout: () => void;
}

export function Offer({
  recipient,
  product,
  loading,
  error,
  cancelled,
  previewOnly,
  onCheckout,
}: OfferProps) {
  if (previewOnly) {
    return (
      <main className="step step-centered">
        <section className="card status-card">
          <h1>Save {recipient}'s song</h1>
          <p>Leave your email and we'll keep your place.</p>
          <label htmlFor="save-email">Email</label>
          <input className="field" id="save-email" type="email" autoComplete="email" />
          <button className="btn-primary" type="button">Save my song</button>
        </section>
      </main>
    );
  }

  return (
    <main className="step offer-step">
      <h1 className="q">Unlock {recipient}'s full song</h1>
      <p className="hint">You've heard the chorus. Here's everything they get:</p>
      {cancelled && <p className="toast" role="status">Nothing was charged.</p>}
      <section className="card offer-card">
        <div className="price-row">
          {product ? <span className="price">{product.localized_price}</span> : <span className="price-loading">Loading price…</span>}
          <span className="price-note">one song · no subscription</span>
        </div>
        <ul className="bundle">
          {[
            "The full song — 60–90 seconds, with their name and your memory in the lyrics",
            "A gift link that plays anywhere, on any phone — and never expires",
            "A lyric card with cover art, to print or post",
            "A share video for stories and chats",
            "Kept forever — theirs in the Porizo app, yours to send again",
          ].map((item) => (
            <li key={item}><CheckIcon /><span>{item}</span></li>
          ))}
        </ul>
        <button className="btn-primary" type="button" disabled={!product || loading} onClick={onCheckout}>
          {loading ? "Opening secure checkout…" : product ? `Unlock for ${product.localized_price}` : "Loading price…"}
        </button>
        {error && <p className="error-text" role="alert">{error}</p>}
        <p className="guarantee">If it doesn't make them feel something, we'll refund it.</p>
        <p className="paymarks">Apple Pay · Google Pay · Card · Secured by Stripe</p>
      </section>
    </main>
  );
}
