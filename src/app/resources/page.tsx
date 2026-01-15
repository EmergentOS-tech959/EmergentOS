'use client';

import { FolderOpen, FileText, Upload } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function ResourcesPage() {
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
        <Button variant="outline" className="gap-2">
          <Upload className="h-4 w-4" />
          Connect Drive
        </Button>
      </div>

      {/* Empty State */}
      <Card className="p-12">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <FolderOpen className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold mb-2">
            Connect Google Drive
          </h2>
          <p className="text-muted-foreground max-w-md mb-6">
            Link your Google Drive to access documents and provide context
            for AI-powered insights.
          </p>
          
          <Button className="gap-2">
            <FileText className="h-4 w-4" />
            Connect Google Drive
          </Button>
        </div>
      </Card>
    </div>
  );
}
