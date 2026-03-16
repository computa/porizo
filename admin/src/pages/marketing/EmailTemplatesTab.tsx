import { useEffect, useState } from 'react';
import { Mail, ChevronDown, ChevronRight } from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';

interface EmailTemplate {
  id: string;
  file: string;
  subject: string;
  label: string;
  day: string;
  html: string | null;
  error?: string;
}

export function EmailTemplatesTab() {
  const { get, loading, error } = useApi();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    get<{ templates: EmailTemplate[] }>('/marketing/email-templates').then((data) => {
      setTemplates(data.templates);
      if (data.templates.length > 0) setExpanded(data.templates[0].id);
    }).catch(console.error);
  }, [get]);

  if (loading && templates.length === 0) return <LoadingState message="Loading templates..." />;
  if (error) return <ErrorState message={`Error: ${error}`} />;

  return (
    <div className="space-y-4">
      <p className="text-slate-400 text-sm">
        Cold outreach email sequence — 3 emails over 8 days. HTML design versions shown below (GMass sends plain-text variants).
      </p>
      {templates.map((tpl) => {
        const isOpen = expanded === tpl.id;
        return (
          <div key={tpl.id} className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
            <button
              onClick={() => setExpanded(isOpen ? null : tpl.id)}
              className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-800/80 transition-colors"
            >
              {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
              <Mail className="w-4 h-4 text-rose-400" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <span className="text-white font-medium">{tpl.label}</span>
                  <span className="text-xs text-slate-500 bg-slate-700/50 px-2 py-0.5 rounded">{tpl.day}</span>
                </div>
                <p className="text-slate-400 text-sm truncate mt-0.5">Subject: {tpl.subject}</p>
              </div>
            </button>
            {isOpen && (
              <div className="border-t border-slate-700/50">
                {tpl.html ? (
                  <iframe
                    srcDoc={tpl.html}
                    sandbox=""
                    className="w-full bg-white"
                    style={{ height: '600px' }}
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
    </div>
  );
}
