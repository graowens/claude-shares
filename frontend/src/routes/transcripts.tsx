import { useState } from "react";
import { createRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { rootRoute } from "./__root";
import { getTranscripts, getTranscriptContent } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileText, ArrowLeft } from "lucide-react";

export const transcriptsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/transcripts",
  component: TranscriptsPage,
});

function TranscriptsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const transcripts = useQuery({
    queryKey: ["transcripts"],
    queryFn: getTranscripts,
  });

  const content = useQuery({
    queryKey: ["transcript", selectedId],
    queryFn: () => getTranscriptContent(selectedId!),
    enabled: !!selectedId,
  });

  if (selectedId) {
    const transcript = transcripts.data?.find((t) => t.id === selectedId);
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSelectedId(null)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold">
            {transcript?.title || transcript?.filename || "Transcript"}
          </h1>
        </div>

        <Card>
          <CardContent className="pt-6">
            {content.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : content.isError ? (
              <p className="text-sm text-red-400">
                Failed to load transcript content.
              </p>
            ) : (
              <pre className="whitespace-pre-wrap text-sm leading-relaxed text-foreground font-mono">
                {content.data?.content}
              </pre>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Transcripts</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Transcript Files
          </CardTitle>
        </CardHeader>
        <CardContent>
          {transcripts.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : transcripts.isError ? (
            <p className="text-sm text-red-400">
              Failed to load transcripts. Is the backend running?
            </p>
          ) : !transcripts.data?.length ? (
            <p className="text-sm text-muted-foreground">
              No transcripts available.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Filename</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transcripts.data.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">
                      {t.title || t.filename}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {t.filename}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(t.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedId(t.id)}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
