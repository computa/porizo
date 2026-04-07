import { useEffect, useState, useCallback } from 'react';
import { Upload, Search, X, Download } from 'lucide-react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';
import { useApi } from '../../hooks/useApi';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';

interface Contact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company_name: string | null;
  contact_name: string | null;
  category: string | null;
  score: number;
  status: string;
  source_file: string | null;
  created_at: string;
}

interface Campaign {
  id: string;
  name: string;
}

const statusColors: Record<string, string> = {
  active: 'bg-green-500/20 text-green-400',
  bounced: 'bg-red-500/20 text-red-400',
  unsubscribed: 'bg-yellow-500/20 text-yellow-400',
};

const columnHelper = createColumnHelper<Contact>();

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const columns = [
  columnHelper.accessor((row) => `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.contact_name || '—', {
    id: 'name',
    header: 'Name',
    cell: (info) => <span className="text-white font-medium">{info.getValue()}</span>,
  }),
  columnHelper.accessor('email', {
    header: 'Email',
    cell: (info) => {
      const email = info.getValue();
      return email
        ? <span className="text-slate-300 text-sm">{email}</span>
        : <span className="text-slate-600">—</span>;
    },
  }),
  columnHelper.accessor('status', {
    header: 'Status',
    cell: (info) => {
      const status = info.getValue() || 'active';
      return (
        <span className={`text-xs px-2 py-0.5 rounded capitalize ${statusColors[status] || 'bg-slate-600/50 text-slate-300'}`}>
          {status}
        </span>
      );
    },
  }),
  columnHelper.accessor('category', {
    header: 'Category',
    cell: (info) => {
      const val = info.getValue();
      return val ? (
        <span className="text-xs bg-slate-700/50 text-slate-300 px-2 py-0.5 rounded">{val}</span>
      ) : <span className="text-slate-600">—</span>;
    },
  }),
  columnHelper.accessor('source_file', {
    header: 'Source',
    cell: (info) => {
      const val = info.getValue();
      return val
        ? <span className="text-slate-400 text-xs truncate block max-w-[150px]" title={val}>{val}</span>
        : <span className="text-slate-600">—</span>;
    },
  }),
];

export function LeadListTab() {
  const { get, loading, error } = useApi();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ inserted: number; skipped: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Export state
  const [showExport, setShowExport] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [exportCampaign, setExportCampaign] = useState('');
  const [exportOpened, setExportOpened] = useState('');
  const [exportClicked, setExportClicked] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [campaignsLoaded, setCampaignsLoaded] = useState(false);

  const fetchContacts = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    params.set('limit', '100');
    const qs = params.toString();
    const data = await get<{ contacts: Contact[]; total: number }>(`/marketing/contacts?${qs}`);
    setContacts(data.contacts);
    setTotal(data.total);
  }, [get, search, statusFilter]);

  useEffect(() => {
    fetchContacts().catch(console.error);
  }, [fetchContacts]);

  // Fetch campaigns for export filter
  useEffect(() => {
    if (showExport && !campaignsLoaded) {
      get<{ campaigns: Campaign[] }>('/marketing/campaigns')
        .then((d) => { setCampaigns(d.campaigns); setCampaignsLoaded(true); })
        .catch(console.error);
    }
  }, [showExport, campaignsLoaded, get]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    setUploadError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const token = localStorage.getItem('adminToken') || '';
      const res = await fetch('/admin/dashboard/marketing/contacts/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error?.message || 'Upload failed');
      } else {
        setUploadResult({ inserted: data.inserted, skipped: data.skipped });
        fetchContacts();
      }
    } catch (err: unknown) {
      setUploadError(getErrorMessage(err, 'Upload failed'));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      params.set('status', statusFilter || 'active');
      if (exportCampaign) params.set('campaign_id', exportCampaign);
      if (exportCampaign && exportOpened) params.set('opened', exportOpened);
      if (exportCampaign && exportClicked) params.set('clicked', exportClicked);

      const token = localStorage.getItem('adminToken') || '';
      const res = await fetch(`/admin/dashboard/marketing/contacts/export?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Export failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `contacts-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setShowExport(false);
    } catch (err: unknown) {
      setExportError(getErrorMessage(err, 'Export failed'));
    } finally {
      setExporting(false);
    }
  };

  const table = useReactTable({
    data: contacts,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-8 py-2 bg-slate-800/50 border border-slate-600/50 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-500/50"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-300"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="bounced">Bounced</option>
          <option value="unsubscribed">Unsubscribed</option>
        </select>

        <label className="flex items-center gap-2 px-4 py-2 bg-rose-500/20 text-rose-400 rounded-lg text-sm font-medium cursor-pointer hover:bg-rose-500/30 transition-colors">
          <Upload className="w-4 h-4" />
          {uploading ? 'Uploading...' : 'Upload CSV'}
          <input type="file" accept=".csv" onChange={handleUpload} className="hidden" disabled={uploading} />
        </label>

        <button
          onClick={() => setShowExport(!showExport)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg text-sm font-medium hover:bg-blue-500/30 transition-colors"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>

        <span className="text-slate-500 text-sm">{total} contacts</span>
      </div>

      {/* Export popover */}
      {showExport && (
        <div className="bg-slate-800/50 border border-blue-500/30 rounded-xl p-4 space-y-3">
          <h4 className="text-white font-medium text-sm">Export Contacts</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Campaign filter</label>
              <select
                value={exportCampaign}
                onChange={(e) => { setExportCampaign(e.target.value); setExportOpened(''); setExportClicked(''); }}
                className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600/50 rounded-lg text-sm text-slate-300"
              >
                <option value="">All contacts (no campaign filter)</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {exportCampaign && (
              <>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Opened?</label>
                  <select
                    value={exportOpened}
                    onChange={(e) => setExportOpened(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600/50 rounded-lg text-sm text-slate-300"
                  >
                    <option value="">Any</option>
                    <option value="true">Opened</option>
                    <option value="false">Not opened</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Clicked?</label>
                  <select
                    value={exportClicked}
                    onChange={(e) => setExportClicked(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600/50 rounded-lg text-sm text-slate-300"
                  >
                    <option value="">Any</option>
                    <option value="true">Clicked</option>
                    <option value="false">Not clicked</option>
                  </select>
                </div>
              </>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleExport}
              disabled={exporting}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              {exporting ? 'Exporting...' : 'Download CSV'}
            </button>
            <button onClick={() => setShowExport(false)} className="px-4 py-2 text-slate-400 hover:text-slate-200 text-sm transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Upload feedback */}
      {uploadResult && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-2 text-sm text-green-400">
          Imported {uploadResult.inserted} contacts ({uploadResult.skipped} duplicates skipped)
        </div>
      )}
      {uploadError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 text-sm text-red-400">
          {uploadError}
        </div>
      )}
      {exportError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 text-sm text-red-400">
          Export error: {exportError}
        </div>
      )}

      {/* Table */}
      {loading && contacts.length === 0 ? (
        <LoadingState message="Loading contacts..." />
      ) : error && contacts.length === 0 ? (
        <ErrorState message={`Error: ${error}`} />
      ) : contacts.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <Upload className="w-8 h-8 mx-auto mb-3 opacity-50" />
          <p>No contacts yet — upload a CSV to get started</p>
        </div>
      ) : (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-900/30">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <th key={header.id} className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-800/30 transition-colors">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-3 text-sm">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
