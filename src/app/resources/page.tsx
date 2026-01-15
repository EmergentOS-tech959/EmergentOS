'use client';

import { useEffect, useMemo, useState } from 'react';
import { FolderOpen, FileText, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase-client';
import { useUser } from '@clerk/nextjs';
import { toast } from 'sonner';
import { ConnectDrive } from '@/components/ConnectDrive';

type DriveDocumentRow = {
  id: string;
  document_id: string;
  name: string;
  mime_type: string;
  folder_path: string | null;
  modified_at: string;
  web_view_link: string | null;
};

export default function ResourcesPage() {
  const { user } = useUser();
  const [docs, setDocs] = useState<DriveDocumentRow[]>([]);
  const [foldersById, setFoldersById] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, DriveDocumentRow[]>();
    for (const d of docs) {
      const key = d.folder_path || 'root';
      map.set(key, [...(map.get(key) || []), d]);
    }
    return Array.from(map.entries());
  }, [docs]);

  const load = async () => {
    if (!user?.id) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('drive_documents')
        .select('id,document_id,name,mime_type,folder_path,modified_at,web_view_link')
        .eq('user_id', user.id)
        .order('modified_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      setDocs((data as unknown as DriveDocumentRow[]) || []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load Drive documents');
    } finally {
      setIsLoading(false);
    }
  };

  const syncDrive = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/integrations/drive/sync', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Sync failed');
      if (body?.warning) toast.warning(body.warning);
      else toast.success(`Drive synced (${body.documentsSynced ?? 0} docs)`);
      await load();
      // Load folder names (best-effort)
      const fRes = await fetch('/api/integrations/drive/folders');
      const fBody = await fRes.json().catch(() => ({}));
      const folderMap: Record<string, string> = {};
      for (const f of fBody?.folders || []) {
        folderMap[String(f.id)] = String(f.name);
      }
      setFoldersById(folderMap);
    } catch (e) {
      console.error(e);
      toast.error('Drive sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Resources</h1>
          <p className="text-muted-foreground">
            Your Google Drive context folder
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={syncDrive} disabled={isSyncing}>
            <RefreshCw className="h-4 w-4" />
            {isSyncing ? 'Syncing…' : 'Sync Drive'}
          </Button>
          <ConnectDrive />
        </div>
      </div>

      {/* Content */}
      <Card className="p-6">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading documents…</div>
        ) : docs.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-10">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <FolderOpen className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-xl font-semibold mb-2">No documents synced</h2>
            <p className="text-muted-foreground max-w-md mb-6">
              Connect Drive and click Sync to load recently modified documents (last 48 hours).
            </p>
            <Button className="gap-2" onClick={syncDrive} disabled={isSyncing}>
              <FileText className="h-4 w-4" />
              {isSyncing ? 'Syncing…' : 'Sync Drive'}
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map(([folderId, items]) => (
              <div key={folderId} className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {folderId === 'root' ? 'Root' : foldersById[folderId] || `Folder ${folderId}`}
                </div>
                <div className="divide-y divide-border rounded-md border border-border">
                  {items.map((d) => (
                    <div key={d.id} className="flex items-center justify-between p-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{d.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{d.mime_type}</div>
                        </div>
                      </div>
                      {d.web_view_link && (
                        <a
                          className="text-xs text-primary hover:underline"
                          href={d.web_view_link}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
