import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  Music,
  Mail,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

/**
 * Admin "Forgot password?" entry point.
 *
 * Posts an email to /admin/auth/forgot-password and surfaces the same
 * generic success state regardless of whether the email maps to an admin —
 * mirroring the server's enumeration-resistant 200 response. The user is
 * directed to check their inbox; the actual reset happens on
 * /admin/reset-password via the link in the email.
 */
export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/admin/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      // The server returns 200 with the same generic body regardless of
      // whether the email exists. We only surface the success view; any
      // non-2xx is a transport-level error worth showing.
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error?.message || data.message || "Request failed");
        setLoading(false);
        return;
      }
      setSubmitted(true);
    } catch (err) {
      console.error("Forgot password failed:", err);
      if (err instanceof TypeError) {
        setError("Network error. Check your connection.");
      } else {
        setError("Failed to connect to server");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-grid p-4">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-rose-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="card rounded-2xl p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-rose-500/20 flex items-center justify-center glow-rose mb-4">
              <Music className="w-8 h-8 text-rose-400" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold text-white">
              Reset Admin Password
            </h1>
            <p className="text-slate-400 mt-1 text-sm">
              Enter the email on your admin account
            </p>
          </div>

          {submitted ? (
            <div className="space-y-5">
              <div
                role="status"
                className="flex items-start gap-3 text-emerald-300 text-sm bg-emerald-500/10 p-4 rounded-lg border border-emerald-500/20"
              >
                <CheckCircle2
                  className="w-5 h-5 flex-shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <div>
                  <p className="font-medium text-emerald-200">
                    Check your inbox
                  </p>
                  <p className="text-emerald-300/80 mt-1">
                    If an admin account exists for that email, a reset link is
                    on its way. The link expires in 30 minutes.
                  </p>
                </div>
              </div>
              <Link
                to="/login"
                className="flex items-center justify-center gap-2 w-full text-slate-300 hover:text-white text-sm font-medium py-2 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-slate-300 mb-2"
                >
                  Email
                </label>
                <div className="relative">
                  <Mail
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500"
                    aria-hidden="true"
                  />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 bg-slate-800/50 border border-slate-600/50 rounded-lg text-white placeholder-slate-500 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 transition-all"
                    placeholder="admin@porizo.app"
                    required
                    autoFocus
                  />
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="flex items-center gap-2 text-rose-400 text-sm bg-rose-500/10 p-3 rounded-lg border border-rose-500/20"
                >
                  <AlertCircle
                    className="w-4 h-4 flex-shrink-0"
                    aria-hidden="true"
                  />
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-rose-500 hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-lg transition-all glow-rose-sm hover:glow-rose"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Sending...
                  </span>
                ) : (
                  "Send reset link"
                )}
              </button>

              <Link
                to="/login"
                className="flex items-center justify-center gap-2 w-full text-slate-300 hover:text-white text-sm font-medium py-2 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                Back to sign in
              </Link>
            </form>
          )}
        </div>

        <p className="text-center text-slate-500 text-xs mt-6 font-data">
          Authorized personnel only
        </p>
      </div>
    </div>
  );
}
