import { useEffect, useState, useCallback } from 'react';
import { Upload, Search, X } from 'lucide-react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type ColumnDef,
} from '@tanstack/react-table';
import { useApi } from '../../hooks/useApi';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';

interface Contact {
  id: string;
  company_name: string;
  website: string | null;
  description: string | null;
  contact_name: string | null;
  email: string | null;
  category: string | null;
  score: number;
  icp_fit_reasoning: string | null;
  audience_reach: string | null;
  partnership_opportunity: string | null;
  contact_approach: string | null;
  source_file: string | null;
  created_at: string;
}

const columnHelper = createColumnHelper<Contact>();

const columns: ColumnDef<Contact, any>[] = [
  columnHelper.accessor('company_name', {
    header: 'Company',
    cell: (info) => <span className="text-white font-medium">{info.getValue()}</span>,
  }),
  columnHelper.accessor('website', {
    header: 'Website',
    cell: (info) => {
      const url = info.getValue();
      const isSafe = url && /^https?:\/\//i.test(url);
      return isSafe ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-rose-400 hover:text-rose-300 text-sm truncate block max-w-[200px]">
          {url.replace(/^https?:\/\/(www\.)?/, '')}
        </a>
      ) : <span className="text-slate-600">{url || '—'}</span>;
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
  columnHelper.accessor('score', {
    header: 'Score',
    cell: (info) => {
      const score = info.getValue();
      const color = score >= 9 ? 'text-green-400' : score >= 7 ? 'text-yellow-400' : 'text-slate-400';
      return <span className={`font-mono text-sm ${color}`}>{score}</span>;
    },
  }),
  columnHelper.accessor('audience_reach', {
    header: 'Reach',
    cell: (info) => <span className="text-slate-300 text-sm">{info.getValue() || '—'}</span>,
  }),
  columnHelper.accessor('contact_approach', {
    header: 'Approach',
    cell: (info) => <span className="text-slate-300 text-sm">{info.getValue() || '—'}</span>,
  }),
];

export function LeadListTab() {
  const { get, loading, error } = useApi();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ inserted: number; skipped: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const fetchContacts = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (category) params.set('category', category);
    params.set('limit', '100');
    const qs = params.toString();
    const data = await get<{ contacts: Contact[]; total: number }>(`/marketing/contacts?${qs}`);
    setContacts(data.contacts);
    setTotal(data.total);
  }, [get, search, category]);

  useEffect(() => {
    fetchContacts().catch(console.error);
  }, [fetchContacts]);

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
    } catch (err: any) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const table = useReactTable({
    data: contacts,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const categories = [...new Set(contacts.map((c) => c.category).filter(Boolean))] as string[];

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search companies..."
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

        {categories.length > 0 && (
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-300"
          >
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        <label className="flex items-center gap-2 px-4 py-2 bg-rose-500/20 text-rose-400 rounded-lg text-sm font-medium cursor-pointer hover:bg-rose-500/30 transition-colors">
          <Upload className="w-4 h-4" />
          {uploading ? 'Uploading...' : 'Upload CSV'}
          <input type="file" accept=".csv" onChange={handleUpload} className="hidden" disabled={uploading} />
        </label>

        <span className="text-slate-500 text-sm">{total} contacts</span>
      </div>

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
