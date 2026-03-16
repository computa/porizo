import { ExternalLink } from 'lucide-react';

const links = [
  { label: 'GMass Dashboard', url: 'https://www.gmass.co/gmass/dashboard', description: 'Email campaign sending & analytics' },
  { label: 'App Store Connect', url: 'https://appstoreconnect.apple.com', description: 'iOS app management & reviews' },
  { label: 'Porizo App Store Page', url: 'https://apps.apple.com/app/porizo/id6758205028', description: 'Live App Store listing' },
  { label: 'Railway Dashboard', url: 'https://railway.app/dashboard', description: 'Backend infrastructure & deployments' },
  { label: 'Replicate Dashboard', url: 'https://replicate.com/dashboard', description: 'AI model API usage & billing' },
  { label: 'Suno AI', url: 'https://suno.com', description: 'Music generation platform' },
];

export function QuickLinksTab() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {links.map((link) => (
        <a
          key={link.url}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5 hover:bg-slate-800/80 hover:border-slate-600/50 transition-all group"
        >
          <div className="flex items-start justify-between mb-2">
            <h3 className="text-white font-medium group-hover:text-rose-400 transition-colors">{link.label}</h3>
            <ExternalLink className="w-4 h-4 text-slate-500 group-hover:text-rose-400 transition-colors flex-shrink-0 mt-0.5" />
          </div>
          <p className="text-slate-400 text-sm">{link.description}</p>
        </a>
      ))}
    </div>
  );
}
