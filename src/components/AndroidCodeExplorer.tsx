import React, { useMemo, useState } from 'react';
import { Check, Copy, Download, FileCode2, Search } from 'lucide-react';
import {
  ANDROID_PROJECT_FILES,
  AndroidFileEntry,
  downloadAndroidProjectZip,
} from '../data/androidProject';

const CATEGORIES: ('All' | AndroidFileEntry['category'])[] = [
  'All',
  'Security & Crypto',
  'Media & Storage',
  'Compose UI',
  'Gradle & Manifest',
  'Termux & Docs',
];

export const AndroidCodeExplorer: React.FC = () => {
  const [selectedCategory, setSelectedCategory] =
    useState<'All' | AndroidFileEntry['category']>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [activePath, setActivePath] = useState(ANDROID_PROJECT_FILES[0].path);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return ANDROID_PROJECT_FILES.filter((file) => {
      const catMatch = selectedCategory === 'All' || file.category === selectedCategory;
      const queryMatch =
        !q ||
        file.path.toLowerCase().includes(q) ||
        file.summary.toLowerCase().includes(q);
      return catMatch && queryMatch;
    });
  }, [selectedCategory, searchQuery]);

  const activeFile =
    ANDROID_PROJECT_FILES.find((f) => f.path === activePath) ??
    filteredFiles[0] ??
    ANDROID_PROJECT_FILES[0];

  const handleCopy = async () => {
    await navigator.clipboard.writeText(activeFile.content);
    setCopiedPath(activeFile.path);
    window.setTimeout(() => setCopiedPath(null), 1800);
  };

  const handleDownloadZip = async () => {
    setDownloading(true);
    try {
      await downloadAndroidProjectZip();
    } finally {
      setDownloading(false);
    }
  };

  const lines = activeFile.content.split('\n');

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      {/* Top Toolbar */}
      <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Complete Android Kotlin &amp; Gradle Project
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
            {ANDROID_PROJECT_FILES.length} source files · Package com.secretgallery.vault · Min SDK 26 / Target SDK 34
          </p>
        </div>
        <button
          type="button"
          disabled={downloading}
          onClick={() => void handleDownloadZip()}
          className="px-4 py-2 rounded-lg bg-teal-700 text-white text-xs font-medium hover:bg-teal-800 disabled:opacity-60 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          {downloading ? 'Packaging ZIP...' : 'Download SecretGallery-Android.zip'}
        </button>
      </div>

      {/* Category Filter + Search */}
      <div className="px-4 sm:px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-white border border-slate-200 rounded-lg">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                selectedCategory === cat
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter files..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-teal-600"
          />
        </div>
      </div>

      {/* Split IDE Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[580px]">
        {/* File List Sidebar */}
        <aside className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-50/50 overflow-y-auto max-h-[300px] lg:max-h-[640px] divide-y divide-slate-100">
          {filteredFiles.length === 0 ? (
            <div className="p-6 text-xs text-slate-500 text-center">
              No files matched "{searchQuery}".
            </div>
          ) : (
            filteredFiles.map((file) => {
              const active = file.path === activeFile.path;
              const shortName = file.path.split('/').pop() ?? file.path;
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setActivePath(file.path)}
                  className={`w-full text-left px-4 py-3 transition-colors flex items-start gap-2.5 ${
                    active ? 'bg-teal-50/70' : 'hover:bg-slate-100/70'
                  }`}
                >
                  <FileCode2
                    className={`w-4 h-4 mt-0.5 shrink-0 ${
                      active ? 'text-teal-700' : 'text-slate-400'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className={`text-xs font-mono truncate ${
                        active ? 'font-semibold text-teal-950' : 'font-medium text-slate-800'
                      }`}
                    >
                      {shortName}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate mt-0.5">
                      {file.path}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </aside>

        {/* Code Viewer Pane */}
        <div className="lg:col-span-8 flex flex-col bg-slate-950 text-slate-100 min-w-0">
          <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-900/70">
            <div className="min-w-0">
              <div className="font-mono text-xs text-teal-300 truncate">{activeFile.path}</div>
              <div className="text-xs text-slate-400 mt-0.5">{activeFile.summary}</div>
            </div>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
            >
              {copiedPath === activeFile.path ? (
                <>
                  <Check className="w-3.5 h-3.5 text-teal-400" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy File
                </>
              )}
            </button>
          </div>

          <div className="flex-1 overflow-auto max-h-[580px] p-4 font-mono text-xs leading-6">
            <table className="w-full border-collapse">
              <tbody>
                {lines.map((line, index) => (
                  <tr key={index} className="hover:bg-slate-900/60">
                    <td className="pr-4 text-right select-none text-slate-600 tabular-nums w-10 align-top">
                      {index + 1}
                    </td>
                    <td className="text-slate-200 whitespace-pre">{line || ' '}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
