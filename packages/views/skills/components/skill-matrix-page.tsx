"use client";

import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  RefreshCw,
  Copy,
  CheckCircle2,
  XCircle,
  ArrowRightLeft,
  Layers,
  Search,
} from "lucide-react";
import type {
  SkillMatrixResponse,
  SkillMatrixSkill,
  SkillMatrixWorkspace,
} from "@multica/core/types";
import { api } from "@multica/core/api";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Checkbox } from "@multica/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@multica/ui/components/ui/dialog";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@multica/ui/components/ui/tooltip";
import { Badge } from "@multica/ui/components/ui/badge";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { toast } from "sonner";

import { PageHeader } from "../../layout/page-header";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillMatrixPageProps {
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const skillMatrixKeys = {
  all: ["skill-matrix"] as const,
  matrix: () => [...skillMatrixKeys.all, "matrix"] as const,
};

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export function SkillMatrixPage({ onBack }: SkillMatrixPageProps) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<SkillMatrixSkill[]>([]);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [selectedTargetWorkspaces, setSelectedTargetWorkspaces] = useState<string[]>([]);
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [bulkSelection, setBulkSelection] = useState<string[]>([]);

  // Fetch matrix data
  const { data: matrixData, isLoading } = useQuery({
    queryKey: skillMatrixKeys.matrix(),
    queryFn: () => api.getSkillMatrix(),
    staleTime: 0, // Always refetch when component mounts or cache is invalidated
  });



  // Filter skills based on search
  const filteredData = useMemo(() => {
    if (!matrixData) return null;
    if (!searchQuery.trim()) return matrixData;

    const query = searchQuery.toLowerCase();
    const skillIndices = matrixData.skills
      .map((s, i) => ({ skill: s, index: i }))
      .filter(({ skill }) =>
        skill.name.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query)
      );

    return {
      skills: skillIndices.map(({ skill }) => skill),
      workspaces: matrixData.workspaces,
      matrix: skillIndices.map(({ index }) => matrixData.matrix[index]),
    };
  }, [matrixData, searchQuery]);

  // Handle sync dialog open for single skill
  const handleSyncClick = (skill: SkillMatrixSkill) => {
    setSelectedSkills([skill]);
    setSyncDialogOpen(true);
  };

  // Handle bulk sync dialog open
  const handleBulkSyncClick = () => {
    if (bulkSelection.length === 0 || !matrixData) return;
    const skillsToSync = matrixData.skills.filter((s) => bulkSelection.includes(s.id));
    setSelectedSkills(skillsToSync);
    setSyncDialogOpen(true);
  };

  // Handle sync submit
  const handleSyncSubmit = async () => {
    if (selectedSkills.length === 0 || selectedTargetWorkspaces.length === 0) return;

    let totalSuccess = 0;
    let totalFailed = 0;

    for (const skill of selectedSkills) {
      try {
        const result = await api.syncSkillToWorkspaces(skill.id, {
          target_workspace_ids: selectedTargetWorkspaces,
          overwrite_existing: overwriteExisting,
        });
        totalSuccess += result.success_count;
        totalFailed += result.failed_count;
      } catch {
        totalFailed += selectedTargetWorkspaces.length;
      }
    }

    if (totalSuccess > 0) {
      toast.success(`Synced ${selectedSkills.length} skills to ${totalSuccess} workspaces`);
    }
    if (totalFailed > 0) {
      toast.error(`Failed to sync to ${totalFailed} workspaces`);
    }

    queryClient.invalidateQueries({ queryKey: skillMatrixKeys.all });
    setSyncDialogOpen(false);
    setSelectedTargetWorkspaces([]);
    setBulkSelection([]);
  };

  // Toggle workspace selection
  const toggleWorkspaceSelection = (wsId: string) => {
    setSelectedTargetWorkspaces((prev) =>
      prev.includes(wsId)
        ? prev.filter((id) => id !== wsId)
        : [...prev, wsId]
    );
  };

  // Toggle bulk skill selection
  const toggleSkillSelection = (skillId: string) => {
    setBulkSelection((prev) =>
      prev.includes(skillId)
        ? prev.filter((id) => id !== skillId)
        : [...prev, skillId]
    );
  };

  // Get skill availability in workspace
  const hasSkillInWorkspace = (skillIdx: number, wsIdx: number) => {
    if (!filteredData) return false;
    return filteredData.matrix[skillIdx]?.[wsIdx] ?? false;
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Skill Matrix"
        description="Manage skills across all your workspaces"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onBack}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Skills
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => queryClient.invalidateQueries({ queryKey: skillMatrixKeys.all })}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        }
      />

      {/* Toolbar */}
      <div className="flex items-center gap-4 px-6 py-4 border-b">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        {bulkSelection.length > 0 && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{bulkSelection.length} selected</Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkSelection([])}
            >
              Clear
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => handleBulkSyncClick()}
            >
              <Copy className="h-4 w-4 mr-1" />
              Sync Selected
            </Button>
          </div>
        )}
      </div>

      {/* Matrix */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        ) : filteredData && filteredData.skills.length > 0 ? (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground sticky left-0 bg-muted/50 z-10">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={
                          bulkSelection.length === filteredData.skills.length &&
                          filteredData.skills.length > 0
                        }
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setBulkSelection(filteredData.skills.map((s) => s.id));
                          } else {
                            setBulkSelection([]);
                          }
                        }}
                      />
                      <span>Skill</span>
                    </div>
                  </th>
                  {filteredData.workspaces.map((ws) => (
                    <th
                      key={ws.id}
                      className="px-3 py-3 text-center font-medium text-muted-foreground min-w-[100px]"
                    >
                      <Tooltip>
                        <TooltipTrigger>
                          <div className="flex flex-col items-center">
                            <span className="truncate max-w-[80px]">{ws.name}</span>
                            <Badge variant="outline" className="text-xs mt-1">
                              {ws.skill_count}
                            </Badge>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{ws.name}</p>
                          <p className="text-muted-foreground">{ws.skill_count} skills</p>
                        </TooltipContent>
                      </Tooltip>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredData.skills.map((skill, skillIdx) => (
                  <tr key={skill.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 sticky left-0 bg-background z-10 border-r">
                      <div className="flex items-start gap-2">
                        <Checkbox
                          checked={bulkSelection.includes(skill.id)}
                          onCheckedChange={() => toggleSkillSelection(skill.id)}
                          className="mt-0.5"
                        />
                        <div>
                          <p className="font-medium">{skill.name}</p>
                          {skill.description && (
                            <p className="text-xs text-muted-foreground line-clamp-1 max-w-[200px]">
                              {skill.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    {filteredData.workspaces.map((ws, wsIdx) => {
                      const hasSkill = hasSkillInWorkspace(skillIdx, wsIdx);
                      return (
                        <td key={ws.id} className="px-3 py-3 text-center">
                          {hasSkill ? (
                            <CheckCircle2 className="h-5 w-5 text-green-500 mx-auto" />
                          ) : (
                            <XCircle className="h-5 w-5 text-muted-foreground/30 mx-auto" />
                          )}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSyncClick(skill)}
                          >
                            <Copy className="h-4 w-4 mr-1" />
                            Sync
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Sync to other workspaces</TooltipContent>
                      </Tooltip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <Layers className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">No skills found</p>
            <p className="text-sm">
              {searchQuery ? "Try a different search term" : "Create your first skill to get started"}
            </p>
          </div>
        )}
      </div>

      {/* Sync Dialog */}
      <Dialog open={syncDialogOpen} onOpenChange={setSyncDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5" />
              {selectedSkills.length > 1 ? `Sync ${selectedSkills.length} Skills` : "Sync Skill"}
            </DialogTitle>
            <DialogDescription>
              {selectedSkills.length > 1 ? (
                <>Copy <strong>{selectedSkills.length} skills</strong> to selected workspaces</>
              ) : (
                <>Copy <strong>{selectedSkills[0]?.name}</strong> to selected workspaces</>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Target Workspaces</label>
              <div className="border rounded-lg divide-y max-h-60 overflow-auto">
                {matrixData?.workspaces.map((ws) => {
                  const skillInWs = matrixData.skills.find(
                    (s) => s.id === selectedSkill?.id
                  );
                  const hasSkill = skillInWs
                    ? matrixData.matrix[
                        matrixData.skills.findIndex((s) => s.id === selectedSkill?.id)
                      ]?.[matrixData.workspaces.findIndex((w) => w.id === ws.id)]
                    : false;

                  return (
                    <div
                      key={ws.id}
                      className="flex items-center justify-between px-4 py-3 hover:bg-muted/50 cursor-pointer"
                      onClick={() => toggleWorkspaceSelection(ws.id)}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={selectedTargetWorkspaces.includes(ws.id)}
                          onCheckedChange={() => toggleWorkspaceSelection(ws.id)}
                        />
                        <div>
                          <p className="font-medium">{ws.name}</p>
                          <p className="text-xs text-muted-foreground">{ws.slug}</p>
                        </div>
                      </div>
                      {hasSkill && (
                        <Badge variant="secondary">Exists</Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="overwrite"
                checked={overwriteExisting}
                onCheckedChange={(checked) => setOverwriteExisting(checked === true)}
              />
              <label htmlFor="overwrite" className="text-sm cursor-pointer">
                Overwrite existing skills with same name
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSyncDialogOpen(false);
                setSelectedTargetWorkspaces([]);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSyncSubmit}
              disabled={selectedTargetWorkspaces.length === 0}
            >
              <Copy className="h-4 w-4 mr-2" />
              Sync{selectedSkills.length > 1 ? ` ${selectedSkills.length} skills` : ""} to {selectedTargetWorkspaces.length} workspace
              {selectedTargetWorkspaces.length !== 1 ? "s" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default SkillMatrixPage;
