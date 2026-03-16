import { useSearchParams } from 'react-router-dom';
import { Megaphone, Mail, Users, BarChart3, ExternalLink } from 'lucide-react';
import { EmailTemplatesTab } from './marketing/EmailTemplatesTab';
import { LeadListTab } from './marketing/LeadListTab';
import { CampaignTrackerTab } from './marketing/CampaignTrackerTab';
import { QuickLinksTab } from './marketing/QuickLinksTab';

const TABS = [
  { id: 'templates', label: 'Template Previews', icon: Mail },
  { id: 'leads', label: 'Lead List', icon: Users },
  { id: 'campaigns', label: 'Campaigns', icon: BarChart3 },
  { id: 'links', label: 'Quick Links', icon: ExternalLink },
] as const;
type TabId = typeof TABS[number]['id'];

export function Marketing() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as TabId) || 'templates';
  const setTab = (tab: TabId) => setSearchParams({ tab });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Megaphone className="w-7 h-7 text-rose-400" />
          Marketing
        </h1>
        <p className="text-slate-400 text-sm mt-1">Outreach campaigns, email templates, and lead management</p>
      </div>

      <div className="border-b border-slate-700/50">
        <nav className="flex gap-6" aria-label="Marketing tabs">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={activeTab === id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === id
                  ? 'text-rose-400 border-rose-500'
                  : 'text-slate-400 hover:text-slate-200 border-transparent'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'templates' && <EmailTemplatesTab />}
      {activeTab === 'leads' && <LeadListTab />}
      {activeTab === 'campaigns' && <CampaignTrackerTab />}
      {activeTab === 'links' && <QuickLinksTab />}
    </div>
  );
}
