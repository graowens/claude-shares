import { useState, useMemo } from "react";
import { createRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { rootRoute } from "./__root";
import {
  getStrategiesByAuthor,
  getTranscriptsByAuthor,
  getTranscriptContent,
  updateStrategy,
  deleteStrategy,
  toggleStrategy,
  createTranscript,
  deleteTranscript,
  type Strategy,
  type Transcript,
} from "@/lib/api";
import { cn, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Pencil,
  Trash2,
  X,
  Save,
  Eye,
  ArrowLeft,
  Loader2,
  BookOpen,
  Lightbulb,
  UserPlus,
  Upload,
  Sparkles,
} from "lucide-react";

export const transcriptsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/transcripts",
  component: TranscriptsPage,
});

function TranscriptsPage() {
  const queryClient = useQueryClient();

  // Data queries
  const strategiesQuery = useQuery({
    queryKey: ["strategies-by-author"],
    queryFn: getStrategiesByAuthor,
  });
  const transcriptsQuery = useQuery({
    queryKey: ["transcripts-by-author"],
    queryFn: getTranscriptsByAuthor,
  });

  // Derive all authors
  const allAuthors = useMemo(() => {
    const authorSet = new Set<string>();
    if (strategiesQuery.data)
      Object.keys(strategiesQuery.data).forEach((a) => authorSet.add(a));
    if (transcriptsQuery.data)
      Object.keys(transcriptsQuery.data).forEach((a) => authorSet.add(a));
    return Array.from(authorSet).sort();
  }, [strategiesQuery.data, transcriptsQuery.data]);

  // UI State
  const [viewingTranscript, setViewingTranscript] = useState<number | null>(null);
  const [editingStrategy, setEditingStrategy] = useState<Strategy | null>(null);
  const [addingTranscriptFor, setAddingTranscriptFor] = useState<string | null>(null);
  const [addingPerson, setAddingPerson] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");
  const [generatedCount, setGeneratedCount] = useState<number | null>(null);

  // Strategy edit form state
  const [stratForm, setStratForm] = useState({ name: "", description: "" });

  // Transcript form state
  const [transcriptForm, setTranscriptForm] = useState({ name: "", content: "" });

  // Transcript content query
  const transcriptContent = useQuery({
    queryKey: ["transcript-content", viewingTranscript],
    queryFn: () => getTranscriptContent(viewingTranscript!),
    enabled: viewingTranscript !== null,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["strategies-by-author"] });
    queryClient.invalidateQueries({ queryKey: ["transcripts-by-author"] });
  };

  // Mutations
  const updateStratMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Strategy> }) => updateStrategy(id, data),
    onSuccess: () => { invalidateAll(); setEditingStrategy(null); },
  });
  const deleteStratMut = useMutation({
    mutationFn: deleteStrategy,
    onSuccess: invalidateAll,
  });
  const toggleStratMut = useMutation({
    mutationFn: toggleStrategy,
    onSuccess: invalidateAll,
  });
  const createTranscriptMut = useMutation({
    mutationFn: createTranscript,
    onSuccess: (data: any) => {
      invalidateAll();
      setAddingTranscriptFor(null);
      if (data.generatedStrategies) {
        setGeneratedCount(data.generatedStrategies);
        setTimeout(() => setGeneratedCount(null), 8000);
      }
    },
  });
  const deleteTranscriptMut = useMutation({
    mutationFn: deleteTranscript,
    onSuccess: invalidateAll,
  });

  // ─── Viewing a transcript ───
  if (viewingTranscript !== null) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setViewingTranscript(null)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold">
            {transcriptContent.data?.name || "Transcript"}
          </h1>
          {transcriptContent.data?.author && (
            <Badge variant="secondary">{transcriptContent.data.author}</Badge>
          )}
        </div>
        <Card>
          <CardContent className="pt-6">
            {transcriptContent.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : transcriptContent.isError ? (
              <p className="text-sm text-red-400">Failed to load transcript.</p>
            ) : (
              <pre className="whitespace-pre-wrap text-sm leading-relaxed text-foreground font-mono">
                {transcriptContent.data?.content}
              </pre>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Main page ───
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookOpen className="h-6 w-6 text-violet-400" />
          <div>
            <h1 className="text-2xl font-bold">Strategies & Transcripts</h1>
            <p className="text-sm text-muted-foreground">
              Upload transcripts to auto-generate trading strategies per person
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={() => { setAddingPerson(true); setNewPersonName(""); }}>
          <UserPlus className="mr-2 h-4 w-4" />
          Add Person
        </Button>
      </div>

      {/* Generated strategies notification */}
      {generatedCount !== null && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="flex items-center gap-3 pt-6 pb-6">
            <Sparkles className="h-5 w-5 text-emerald-400" />
            <p className="text-sm">
              <span className="font-bold text-emerald-400">{generatedCount} strateg{generatedCount !== 1 ? "ies" : "y"}</span>
              {" "}auto-generated from the transcript by Claude
            </p>
          </CardContent>
        </Card>
      )}

      {/* Add Person inline */}
      {addingPerson && (
        <Card className="border-violet-500/30">
          <CardContent className="flex items-end gap-4 pt-6">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Person Name</Label>
              <Input
                value={newPersonName}
                onChange={(e) => setNewPersonName(e.target.value)}
                placeholder="e.g. John"
                className="w-48"
              />
            </div>
            <Button
              onClick={() => {
                if (newPersonName.trim()) {
                  setAddingTranscriptFor(newPersonName.trim());
                  setTranscriptForm({ name: "", content: "" });
                  setAddingPerson(false);
                }
              }}
              disabled={!newPersonName.trim()}
            >
              <Upload className="mr-2 h-4 w-4" />
              Add with Transcript
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setAddingPerson(false)}>
              <X className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {(strategiesQuery.isLoading || transcriptsQuery.isLoading) && (
        <p className="text-sm text-muted-foreground">Loading...</p>
      )}

      {/* Per-author cards */}
      {allAuthors.map((author) => {
        const strategies = strategiesQuery.data?.[author] || [];
        const transcripts = transcriptsQuery.data?.[author] || [];
        const enabledCount = strategies.filter((s) => s.enabled).length;

        return (
          <Card key={author}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-500/20 text-sm font-bold text-violet-400">
                    {author[0]}
                  </div>
                  <span className="text-xl">{author}</span>
                  <Badge variant="secondary" className="text-xs">
                    {strategies.length} strateg{strategies.length !== 1 ? "ies" : "y"} ({enabledCount} active)
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    {transcripts.length} transcript{transcripts.length !== 1 ? "s" : ""}
                  </Badge>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* ── Strategies Section ── */}
              <div>
                <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-muted-foreground">
                  <Lightbulb className="h-4 w-4" />
                  Strategies
                  <span className="font-normal text-xs">(auto-generated from transcripts)</span>
                </div>

                {strategies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No strategies yet — upload a transcript to generate them.</p>
                ) : (
                  <div className="space-y-2">
                    {strategies.map((strat) => (
                      <div
                        key={strat.id}
                        className={cn(
                          "rounded-md border p-3",
                          strat.enabled ? "border-emerald-500/20 bg-emerald-500/5" : "opacity-60"
                        )}
                      >
                        {editingStrategy?.id === strat.id ? (
                          /* Edit form inline */
                          <div className="space-y-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Name</Label>
                              <Input
                                value={stratForm.name}
                                onChange={(e) => setStratForm((f) => ({ ...f, name: e.target.value }))}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Description</Label>
                              <textarea
                                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[100px]"
                                value={stratForm.description}
                                onChange={(e) => setStratForm((f) => ({ ...f, description: e.target.value }))}
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                onClick={() =>
                                  updateStratMut.mutate({
                                    id: strat.id,
                                    data: { name: stratForm.name, description: stratForm.description },
                                  })
                                }
                                disabled={updateStratMut.isPending}
                              >
                                {updateStratMut.isPending ? (
                                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Save className="mr-1.5 h-3.5 w-3.5" />
                                )}
                                Save
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingStrategy(null)}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          /* Display */
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold text-sm">{strat.name}</span>
                                <Badge
                                  variant={strat.enabled ? "success" : "secondary"}
                                  className="text-xs cursor-pointer"
                                  onClick={() => toggleStratMut.mutate(strat.id)}
                                >
                                  {strat.enabled ? "Active" : "Disabled"}
                                </Badge>
                                {strat.source && (
                                  <span className="text-xs text-muted-foreground">
                                    from: {strat.source}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">
                                {strat.description}
                              </p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => {
                                  setEditingStrategy(strat);
                                  setStratForm({ name: strat.name, description: strat.description });
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-red-400 hover:text-red-300"
                                onClick={() => deleteStratMut.mutate(strat.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Transcripts Section ── */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                    <FileText className="h-4 w-4" />
                    Transcripts
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setAddingTranscriptFor(author);
                      setTranscriptForm({ name: "", content: "" });
                    }}
                  >
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                    Upload Transcript
                  </Button>
                </div>

                {transcripts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No transcripts yet.</p>
                ) : (
                  <div className="space-y-1">
                    {transcripts.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between rounded-md border px-3 py-2"
                      >
                        <div className="flex items-center gap-3">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">{t.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(t.createdAt)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setViewingTranscript(t.id)}
                          >
                            <Eye className="mr-1.5 h-3.5 w-3.5" />
                            View
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-red-400 hover:text-red-300"
                            onClick={() => deleteTranscriptMut.mutate(t.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Upload transcript form */}
                {addingTranscriptFor === author && (
                  <div className="mt-3 rounded-md border border-violet-500/30 bg-violet-500/5 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-violet-400" />
                      <p className="text-sm font-semibold text-violet-300">
                        Upload Transcript — strategies will be auto-generated by Claude
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Name</Label>
                      <Input
                        value={transcriptForm.name}
                        onChange={(e) => setTranscriptForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="Transcript name"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Content</Label>
                      <textarea
                        className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[200px] font-mono"
                        value={transcriptForm.content}
                        onChange={(e) => setTranscriptForm((f) => ({ ...f, content: e.target.value }))}
                        placeholder="Paste transcript content here..."
                      />
                    </div>
                    <div className="flex items-center gap-4">
                      <Button
                        onClick={() =>
                          createTranscriptMut.mutate({
                            author,
                            name: transcriptForm.name,
                            content: transcriptForm.content,
                          })
                        }
                        disabled={!transcriptForm.name.trim() || !transcriptForm.content.trim() || createTranscriptMut.isPending}
                      >
                        {createTranscriptMut.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="mr-2 h-4 w-4" />
                        )}
                        {createTranscriptMut.isPending ? "Analyzing & Saving..." : "Upload & Generate Strategies"}
                      </Button>
                      <Button variant="ghost" onClick={() => setAddingTranscriptFor(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* Upload form for new person (not yet in allAuthors) */}
      {addingTranscriptFor && !allAuthors.includes(addingTranscriptFor) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-500/20 text-sm font-bold text-violet-400">
                {addingTranscriptFor[0]}
              </div>
              <span className="text-xl">{addingTranscriptFor}</span>
              <Badge variant="secondary" className="text-xs">New person</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-violet-500/30 bg-violet-500/5 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-400" />
                <p className="text-sm font-semibold text-violet-300">
                  Upload Transcript — strategies will be auto-generated by Claude
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Name</Label>
                <Input
                  value={transcriptForm.name}
                  onChange={(e) => setTranscriptForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Transcript name"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Content</Label>
                <textarea
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[200px] font-mono"
                  value={transcriptForm.content}
                  onChange={(e) => setTranscriptForm((f) => ({ ...f, content: e.target.value }))}
                  placeholder="Paste transcript content here..."
                />
              </div>
              <div className="flex items-center gap-4">
                <Button
                  onClick={() =>
                    createTranscriptMut.mutate({
                      author: addingTranscriptFor,
                      name: transcriptForm.name,
                      content: transcriptForm.content,
                    })
                  }
                  disabled={!transcriptForm.name.trim() || !transcriptForm.content.trim() || createTranscriptMut.isPending}
                >
                  {createTranscriptMut.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  {createTranscriptMut.isPending ? "Analyzing & Saving..." : "Upload & Generate Strategies"}
                </Button>
                <Button variant="ghost" onClick={() => setAddingTranscriptFor(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {allAuthors.length === 0 && !addingTranscriptFor && !strategiesQuery.isLoading && !transcriptsQuery.isLoading && (
        <Card>
          <CardContent className="py-12 text-center">
            <BookOpen className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-muted-foreground">
              No strategies or transcripts yet. Add a person to get started.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
