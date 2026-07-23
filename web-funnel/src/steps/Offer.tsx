import { CheckIcon } from "../components/Icons";
import type { Product } from "../api/funnel";

interface OfferProps {
  recipient: string;
  products: Product[];
  selectedPriceKey?: string;
  walletBalance?: number;
  loading: boolean;
  error?: string;
  cancelled?: boolean;
  previewOnly?: boolean;
  onSelectProduct: (priceKey: string) => void;
  onCheckout: () => void;
  onUseCredit: () => void;
}

export function Offer({
  recipient,
  products,
  selectedPriceKey,
  walletBalance,
  loading,
  error,
  cancelled,
  previewOnly,
  onCheckout,
  onSelectProduct,
  onUseCredit,
}: OfferProps) {
  const product =
    products.find((candidate) => candidate.price_key === selectedPriceKey) ??
    (products.length === 1 ? products[0] : undefined);
  const hasCredit = (walletBalance ?? 0) > 0;

  if (previewOnly) {
    return (
      <main className="step step-centered">
        <section className="card status-card">
          <h1>{recipient}'s song is saved.</h1>
          <p>
            Purchases are paused right now. Come back soon, or contact support
            if you need help.
          </p>
          <a className="btn-primary" href="/support">
            Contact support
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className="step offer-step">
      <h1 className="q">Unlock {recipient}'s full song</h1>
      <p className="hint">
        You've heard the chorus. Here's everything they get:
      </p>
      {cancelled && (
        <p className="toast" role="status">
          Nothing was charged.
        </p>
      )}
      <section className="card offer-card">
        {hasCredit ? (
          <div className="wallet-choice">
            <strong>
              {walletBalance} gift {walletBalance === 1 ? "credit" : "credits"}{" "}
              available in Porizo
            </strong>
            <p>Use your gift credits here or in the Porizo app.</p>
          </div>
        ) : products.length > 1 ? (
          <fieldset className="bundle-choices">
            <legend>Choose a gift bundle</legend>
            {products.map((candidate) => (
              <label key={candidate.price_key}>
                <input
                  type="radio"
                  name="gift-bundle"
                  value={candidate.price_key}
                  checked={candidate.price_key === product?.price_key}
                  onChange={() => onSelectProduct(candidate.price_key)}
                />
                <span>
                  {candidate.token_count} gift{" "}
                  {candidate.token_count === 1 ? "credit" : "credits"} ·{" "}
                  {candidate.localized_price}
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <div className="price-row">
          {hasCredit ? (
            <span className="price">1 gift credit</span>
          ) : product ? (
            <span className="price">{product.localized_price}</span>
          ) : (
            <span className="price-loading">Loading price…</span>
          )}
          <span className="price-note">
            {hasCredit
              ? `${walletBalance! - 1} left after this song`
              : `${product?.token_count ?? 1} gift credit${product?.token_count === 1 ? "" : "s"} · no subscription`}
          </span>
        </div>
        <ul className="bundle">
          {[
            "The full song — 60–90 seconds, with their name and your memory in the lyrics",
            "A gift link that plays anywhere, on any phone — and never expires",
            "A lyric card with cover art, to print or post",
            "A share video for stories and chats",
            "Kept forever — theirs in the Porizo app, yours to send again",
          ].map((item) => (
            <li key={item}>
              <CheckIcon />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <p className="guarantee">
          If it doesn't make them feel something, we'll refund it.
        </p>
      </section>
      {!hasCredit && (
        <p className="paymarks offer-paymarks">
          Apple Pay · Google Pay · Card · Secured by Stripe
        </p>
      )}
      {!hasCredit && (
        <p className="account-note">
          Sign in with your receipt email to use remaining gift credits here or
          in the Porizo app.
        </p>
      )}
      <div className="cta-bar">
        <button
          className="btn-primary"
          type="button"
          disabled={(!hasCredit && !product) || loading}
          onClick={hasCredit ? onUseCredit : onCheckout}
        >
          {loading
            ? hasCredit
              ? "Applying gift credit…"
              : "Opening secure checkout…"
            : hasCredit
              ? "Use 1 gift credit"
              : product
                ? `Unlock for ${product.localized_price}`
                : "Loading price…"}
        </button>
      </div>
    </main>
  );
}
