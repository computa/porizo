import { useState, useEffect, type FormEvent } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import {
  Music,
  KeyRound,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
} from "lucide-react";

/**
 * Admin password reset completion page.
 *
 * Reached via the link in the reset email: /admin/reset-password?token=…
 * Posts {token, new_password} to /admin/auth/reset-password. On success,
 * redirects to /admin/login with a success flag the Login page can surface
 * via a one-time banner.
 */
export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") || "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [missingToken, setMissingToken] = useState(false);

  useEffect(() => {
    // Reaching this page without a token means the user typed the URL
    // directly or the email link was malformed. Render a tailored error
    // rather than letting them submit a doomed form.
    setMissingToken(token.length === 0);
  }, [token]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/admin/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: newPassword }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const code = data.error || data.code;
        if (code === "INVALID_TOKEN") {
          setError(
            "This reset link is invalid or has expired. Request a new one to continue.",
          );
        } else {
          setError(data.message || data.error?.message || "Reset failed");
        }
        setLoading(false);
        return;
      }

      // Successful reset wipes every active session — including any the
      // user may still hold in this browser. Force a clean redirect to
      // /login so localStorage tokens from a prior session don't cause a
      // stale auth attempt on the next page.
      try {
        localStorage.removeItem("adminToken");
        localStorage.removeItem("adminUser");
      } catch {
        /* localStorage may be disabled — non-fatal */
      }
      navigate("/login?reset=1", { replace: true });
    } catch (err) {
      console.error("Reset failed:", err);
      if (err instanceof TypeError) {
        setError("Network error. Check your connection.");
      } else {
        setError("Failed to connect to server");
      }
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
              Set a new password
            </h1>
            <p className="text-slate-400 mt-1 text-sm">
              Choose a password you haven't used before
            </p>
          </div>

          {missingToken ? (
            <div className="space-y-5">
              <div
                role="alert"
                className="flex items-start gap-3 text-rose-300 text-sm bg-rose-500/10 p-4 rounded-lg border border-rose-500/20"
              >
                <AlertCircle
                  className="w-5 h-5 flex-shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <div>
                  <p className="font-medium text-rose-200">
                    Reset link is missing
                  </p>
                  <p className="text-rose-300/80 mt-1">
                    Use the link in your reset email, or request a new one.
                  </p>
                </div>
              </div>
              <Link
                to="/forgot-password"
                className="block w-full text-center bg-rose-500 hover:bg-rose-600 text-white font-medium py-3 px-4 rounded-lg transition-all glow-rose-sm hover:glow-rose"
              >
                Request a new reset link
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor="new-password"
                  className="block text-sm font-medium text-slate-300 mb-2"
                >
                  New password
                </label>
                <div className="relative">
                  <KeyRound
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500"
                    aria-hidden="true"
                  />
                  <input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 bg-slate-800/50 border border-slate-600/50 rounded-lg text-white placeholder-slate-500 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 transition-all"
                    placeholder="At least 8 characters"
                    minLength={8}
                    required
                    autoFocus
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="confirm-password"
                  className="block text-sm font-medium text-slate-300 mb-2"
                >
                  Confirm password
                </label>
                <div className="relative">
                  <CheckCircle2
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500"
                    aria-hidden="true"
                  />
                  <input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 bg-slate-800/50 border border-slate-600/50 rounded-lg text-white placeholder-slate-500 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 transition-all"
                    placeholder="Re-enter password"
                    minLength={8}
                    required
                    autoComplete="new-password"
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
                    Updating...
                  </span>
                ) : (
                  "Set new password"
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
