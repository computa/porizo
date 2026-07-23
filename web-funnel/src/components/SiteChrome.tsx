import { useRef, useState, type FormEvent, type RefObject } from "react";
import { rememberOrderRecovery } from "../order-recovery";
import { rememberPendingEtsyReceipt } from "../etsy-fulfilment";

// `commerceFree` renders the brand-only variant for an already-paid Etsy
// fulfilment session: the Porizo wordmark stays, but every commerce/nav
// affordance (links, Sign in) is dropped so the buyer is never invited to buy
// elsewhere or hit a signup wall.
export function SiteNav({ commerceFree = false }: { commerceFree?: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  if (commerceFree) {
    return (
      <nav className="nav nav--static" aria-label="Primary navigation">
        <div className="container">
          <div className="nav__inner">
            <span className="nav__logo" aria-label="Porizo">
              <span className="nav__logo-text">Porizo</span>
            </span>
          </div>
        </div>
      </nav>
    );
  }

  return (
    <>
      <nav className="nav nav--static" aria-label="Primary navigation">
        <div className="container">
          <div className="nav__inner">
            <a href="/" className="nav__logo" aria-label="Porizo home">
              <span className="nav__logo-text">Porizo</span>
            </a>
            <div className="nav__links">
              <a href="/#how" className="nav__link">
                How it works
              </a>
              <a href="/pricing" className="nav__link">
                Pricing
              </a>
              <a href="/blog" className="nav__link nav__link--secondary">
                Blog
              </a>
            </div>
            <button
              className="nav__cta nav__cta--quiet"
              type="button"
              onClick={() => dialogRef.current?.showModal()}
            >
              Sign in
            </button>
          </div>
        </div>
      </nav>
      <SignInDialog dialogRef={dialogRef} />
    </>
  );
}

function SignInDialog({
  dialogRef,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
}) {
  return (
    <dialog className="sign-in-dialog" ref={dialogRef}>
      <SiteSignInForm onClose={() => dialogRef.current?.close()} />
    </dialog>
  );
}

export function SiteSignInForm({
  onClose,
  recoverySessionId,
  recoveryKind = "session",
}: {
  onClose?: () => void;
  recoverySessionId?: string;
  recoveryKind?: "session" | "order" | "etsy" | "etsy_unit";
}) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch("/auth/magic/request", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          email: email.trim(),
          platform: "web",
          purpose: "login",
          ...(recoveryKind === "etsy" ? { return_to: "etsy" } : {}),
        }),
      });
      if (!response.ok) throw new Error("Sign-in request failed");
      if (recoverySessionId) {
        if (recoveryKind === "etsy") {
          rememberPendingEtsyReceipt(recoverySessionId);
        } else {
          rememberOrderRecovery({ kind: recoveryKind, value: recoverySessionId });
        }
      }
      setSent(true);
    } catch {
      setError("Sign-in could not be completed. Try again or contact support.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="sign-in-dialog__top">
        <h2>{sent ? "Check your email" : "Sign in with email"}</h2>
        {onClose && (
          <button className="btn-quiet" type="button" onClick={onClose}>
            Close
          </button>
        )}
      </div>
      {sent ? (
        <>
          <p>
            Link sent to {email.trim()}. Open it in this browser to recover your
            purchase.
          </p>
          <button
            className="btn-quiet"
            type="button"
            onClick={() => setSent(false)}
          >
            Wrong email? Change it
          </button>
        </>
      ) : (
        <form onSubmit={submit}>
          <label htmlFor="sign-in-email">Email address</label>
          <input
            className="field"
            id="sign-in-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <button
            className="btn-primary"
            type="submit"
            disabled={pending || !email.trim()}
          >
            {pending ? "Sending link..." : "Email me a sign-in link"}
          </button>
        </form>
      )}
    </>
  );
}

// `commerceFree` keeps the brand and legal footing for an already-paid Etsy
// fulfilment session while dropping the Product/Company/Song-gift columns —
// every link there either sells another song or navigates back to the storefront.
export function SiteFooter({
  commerceFree = false,
}: {
  commerceFree?: boolean;
}) {
  if (commerceFree) {
    return (
      <footer className="footer funnel-footer">
        <div className="container">
          <div className="footer__inner">
            <div className="footer__brand">
              <span className="nav__logo">
                <span className="nav__logo-text">Porizo</span>
              </span>
              <p className="footer__tagline">Your moment, in a song.</p>
            </div>
            <div className="footer__col">
              <h4>Legal</h4>
              <a href="/legal/privacy">Privacy</a>
              <a href="/legal/terms">Terms</a>
            </div>
          </div>
          <div className="footer__bottom">
            <span>© 2026 Porizo. All rights reserved.</span>
            <span>One song at a time.</span>
          </div>
        </div>
      </footer>
    );
  }

  return (
    <footer className="footer funnel-footer">
      <div className="container">
        <div className="footer__inner">
          <div className="footer__brand">
            <a href="/" className="nav__logo">
              <span className="nav__logo-text">Porizo</span>
            </a>
            <p className="footer__tagline">Your moment, in a song.</p>
          </div>
          <div className="footer__col">
            <h4>Product</h4>
            <a href="/pricing">Pricing</a>
            <a href="/#how">How it works</a>
            <a href="/download">Download</a>
          </div>
          <div className="footer__col">
            <h4>Company</h4>
            <a href="/about">About</a>
            <a href="/blog">Blog</a>
            <a href="/support">Support</a>
          </div>
          <div className="footer__col">
            <h4>Legal</h4>
            <a href="/legal/privacy">Privacy</a>
            <a href="/legal/terms">Terms</a>
          </div>
          <div className="footer__col">
            <h4>Song gifts</h4>
            <a href="/gifts/">All gift ideas</a>
            <a href="/fathers-day-song">Father's Day songs</a>
            <a href="/anniversary-song-gift">Anniversary songs</a>
            <a href="/birthday-song-maker">Birthday songs</a>
            <a href="/wedding-song-gift">Wedding songs</a>
          </div>
        </div>
        <div className="footer__bottom">
          <span>© 2026 Porizo. All rights reserved.</span>
          <span>One song at a time.</span>
        </div>
      </div>
    </footer>
  );
}

export function DimBrand({ commerceFree = false }: { commerceFree?: boolean }) {
  if (commerceFree) {
    return <span className="dim-brand" aria-label="Porizo">Porizo</span>;
  }
  return (
    <a className="dim-brand" href="/" aria-label="Porizo home">
      Porizo
    </a>
  );
}
