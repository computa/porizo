import { useEffect, useState } from "react";
import { Mail, ChevronDown, ChevronRight } from "lucide-react";
import { useApi } from "../../hooks/useApi";
import { LoadingState } from "../../components/LoadingState";
import { ErrorState } from "../../components/ErrorState";

interface EmailTemplate {
  id: string;
  file: string;
  subject: string;
  label: string;
  day: string;
  html: string | null;
  error?: string;
}

interface TemplatesResponse {
  templates: EmailTemplate[];
  cold_email_templates?: EmailTemplate[];
}

function TemplateGroup({
  title,
  blurb,
  items,
  expandedId,
  onToggle,
}: {
  title: string;
  blurb: string;
  items: EmailTemplate[];
  expandedId: string | null;
  onToggle: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-white text-sm font-semibold uppercase tracking-wide">
          {title}
        </h2>
        <p className="text-slate-400 text-sm mt-1">{blurb}</p>
      </div>
      {items.map((tpl) => {
        const isOpen = expandedId === tpl.id;
        return (
          <div
            key={tpl.id}
            className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden"
          >
            <button
              onClick={() => onToggle(tpl.id)}
              className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-800/80 transition-colors"
            >
              {isOpen ? (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-400" />
              )}
              <Mail className="w-4 h-4 text-rose-400" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <span className="text-white font-medium">{tpl.label}</span>
                  <span className="text-xs text-slate-500 bg-slate-700/50 px-2 py-0.5 rounded">
                    {tpl.day}
                  </span>
                </div>
                <p className="text-slate-400 text-sm truncate mt-0.5">
                  Subject: {tpl.subject}
                </p>
              </div>
            </button>
            {isOpen && (
              <div className="border-t border-slate-700/50">
                {tpl.html ? (
                  <iframe
                    srcDoc={tpl.html}
                    sandbox=""
                    className="w-full bg-white"
                    style={{ height: "600px" }}
                    title={`Preview: ${tpl.label}`}
                  />
                ) : (
                  <div className="p-8 text-center text-slate-500">
                    Template file not found: {tpl.file}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

export function EmailTemplatesTab() {
  const { get, loading, error, setError } = useApi();
  const [nurture, setNurture] = useState<EmailTemplate[]>([]);
  const [cold, setCold] = useState<EmailTemplate[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const data = await get<TemplatesResponse>("/marketing/email-templates");
        if (cancelled) return;
        setNurture(data.templates ?? []);
        setCold(data.cold_email_templates ?? []);
        const first =
          data.templates?.[0]?.id ?? data.cold_email_templates?.[0]?.id ?? null;
        if (first) setExpanded(first);
      } catch {
        if (!cancelled) {
          setNurture([]);
          setCold([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [get, setError]);

  const toggle = (id: string) => setExpanded((cur) => (cur === id ? null : id));

  if (loading && nurture.length === 0 && cold.length === 0)
    return <LoadingState message="Loading templates..." />;
  if (error) return <ErrorState message={`Error: ${error}`} />;

  return (
    <div className="space-y-8">
      <TemplateGroup
        title="Nurture Sequence"
        blurb="3-email cold outreach sent via GMass over 8 days."
        items={nurture}
        expandedId={expanded}
        onToggle={toggle}
      />
      <TemplateGroup
        title="Cold Email Templates"
        blurb="Templates used by the backend cold-email job (marketing/email/)."
        items={cold}
        expandedId={expanded}
        onToggle={toggle}
      />
    </div>
  );
}
