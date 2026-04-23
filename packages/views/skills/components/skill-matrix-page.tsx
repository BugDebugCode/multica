"use client";

import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  RefreshCw,
  ArrowRightLeft,
  Layers,
  Search,
  Check,
  X,
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

interface CellSelection {
  skillId: string;
  workspaceId: string;
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
  const [selectedCells, setSelectedCells] = useState<CellSelection[]>([]);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Fetch matrix data
  const { data: matrixData, isLoading } = useQuery({
    queryKey: skillMatrixKeys.matrix(),
    queryFn: () => api.getSkillMatrix(),
    staleTime: 0,
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

  // Check if skill exists in workspace
  const hasSkillInWorkspace = (skillIdx: number, wsIdx: number) => {
    if (!filteredData) return false;
    return filteredData.matrix[skillIdx]?.[wsIdx] ?? false;
  };

  // Check if cell is selected
  const isCellSelected = (skillId: string, wsId: string) => {
    return selectedCells.some((c) => c.skillId === skillId && c.workspaceId === wsId);
  };

  // Toggle cell selection
  const toggleCell = (skillId: string, wsId: string) => {
    setSelectedCells((prev) => {
      const exists = prev.some((c) => c.skillId === skillId && c.workspaceId === wsId);
      if (exists) {
        return prev.filter((c) => !(c.skillId === skillId && c.workspaceId === wsId));
      }
      return [...prev, { skillId, workspaceId: wsId }];
    });
  };

  // Get unique skills and workspaces from selection
  const selectedSkills = useMemo(() => {
    if (!matrixData) return [];
    const skillIds = [...new Set(selectedCells.map((c) => c.skillId))];
    return skillIds
      .map((id) => matrixData.skills.find((s) => s.id === id))
      .filter(Boolean) as SkillMatrixSkill[];
  }, [selectedCells, matrixData]);

  const selectedWorkspaces = useMemo(() => {
    if (!matrixData) return [];
    const wsIds = [...new Set(selectedCells.map((c) => c.workspaceId))];
    return wsIds
      .map((id) => matrixData.workspaces.find((w) => w.id === id))
      .filter(Boolean) as SkillMatrixWorkspace[];
  }, [selectedCells, matrixData]);

  // Group selections by skill for sync
  const selectionsBySkill = useMemo(() => {
    const grouped: Record<string, string[]> = {};
    selectedCells.forEach((cell) => {
      if (!grouped[cell.skillId]) {
        grouped[cell.skillId] = [];
      }
      grouped[cell.skillId].push(cell.workspaceId);
    });
    return grouped;
  }, [selectedCells]);

  // Handle sync
  const handleSync = async () => {
    if (selectedCells.length === 0 || !matrixData) return;

    setIsSyncing(true);
    let totalSuccess = 0;
    let totalFailed = 0;

    for (const [skillId, workspaceIds] of Object.entries(selectionsBySkill)) {
      try {
        const result = await api.syncSkillToWorkspaces(skillId, {
          target_workspace_ids: workspaceIds,
          overwrite_existing: overwriteExisting,
        });
        totalSuccess += result.success_count;
        totalFailed += result.failed_count;
      } catch {
        totalFailed += workspaceIds.length;
      }
    }

    if (totalSuccess > 0) {
      toast.success(`Synced ${selectedSkills.length} skills to ${totalSuccess} workspaces`);
    }
    if (totalFailed > 0) {
      toast.error(`Failed to sync ${totalFailed} workspaces`);
    }

    queryClient.invalidateQueries({ queryKey: skillMatrixKeys.all });
    setSelectedCells([]);
    setSyncDialogOpen(false);
    setIsSyncing(false);
  };

  // Clear all selections
  const clearSelection = () => {
    setSelectedCells([]);
  };

  // Select all missing cells (all skills to all workspaces where they don't exist)
  const selectAllMissing = () => {
    if (!filteredData) return;
    const newSelections: CellSelection[] = [];
    filteredData.skills.forEach((skill, skillIdx) => {
      filteredData.workspaces.forEach((ws, wsIdx) => {
        if (!hasSkillInWorkspace(skillIdx, wsIdx)) {
          newSelections.push({ skillId: skill.id, workspaceId: ws.id });
        }
      });
    });
    setSelectedCells(newSelections);
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Skill Matrix"
        description="Select cells to sync skills across workspaces"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onBack}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
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
      <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/30">
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search skills..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-80"
            />
          </div>
          {selectedCells.length > 0 && (
            <div className="flex items-center gap-2">
              <Badge variant="default" className="bg-primary">
                {selectedCells.length} selected
              </Badge>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={selectAllMissing}
            disabled={!filteredData}
          >
            Select All Missing
          </Button>
          {selectedCells.length > 0 && (
            <Button
              variant="default"
              size="sm"
              onClick={() => setSyncDialogOpen(true)}
            >
              <ArrowRightLeft className="h-4 w-4 mr-2" />
              Sync {selectedCells.length} cells
            </Button>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 px-6 py-2 border-b bg-muted/10 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-green-500/20 border border-green-500/50 flex items-center justify-center">
            <Check className="w-3 h-3 text-green-600" />
          </div>
          <span>Skill exists</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded border-2 border-primary bg-primary/10" />
          <span>Selected for sync</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded border border-muted-foreground/30" />
          <span>Not present (click to select)</span>
        </div>
      </div>

      {/* Matrix */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        ) : filteredData && filteredData.skills.length > 0 ? (
          <div className="border rounded-lg overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0 z-20">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground sticky left-0 bg-muted/50 z-30 border-r min-w-[250px]">
                    Skill
                  </th>
                  {filteredData.workspaces.map((ws) => (
                    <th
                      key={ws.id}
                      className="px-2 py-3 text-center font-medium text-muted-foreground min-w-[80px]"
                    >
                      <Tooltip>
                        <TooltipTrigger>
                          <div className="flex flex-col items-center">
                            <span className="truncate max-w-[70px] text-xs">{ws.name}</span>
                            <Badge variant="outline" className="text-[10px] mt-1 px-1.5 py-0">
                              {ws.skill_count}
                            </Badge>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="font-medium">{ws.name}</p>
                          <p className="text-muted-foreground text-xs">{ws.skill_count} skills</p>
                        </TooltipContent>
                      </Tooltip>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredData.skills.map((skill, skillIdx) => (
                  <tr key={skill.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 sticky left-0 bg-background z-20 border-r">
                      <div>
                        <p className="font-medium text-sm">{skill.name}</p>
                        {skill.description && (
                          <p className="text-xs text-muted-foreground line-clamp-1 max-w-[200px] mt-0.5">
                            {skill.description}
                          </p>
                        )}
                      </div>
                    </td>
                    {filteredData.workspaces.map((ws, wsIdx) => {
                      const hasSkill = hasSkillInWorkspace(skillIdx, wsIdx);
                      const isSelected = isCellSelected(skill.id, ws.id);
                      
                      return (
                        <td key={ws.id} className="p-1 text-center">
                          <button
                            onClick={() => !hasSkill && toggleCell(skill.id, ws.id)}
                            disabled={hasSkill}
                            className={`
                              w-8 h-8 rounded-md transition-all flex items-center justify-center
                              ${hasSkill 
                                ? "bg-green-500/15 cursor-default" 
                                : isSelected
                                  ? "bg-primary/20 border-2 border-primary hover:bg-primary/30"
                                  : "border border-muted-foreground/20 hover:border-muted-foreground/40 hover:bg-muted/50"
                              }
                            `}
                            title={hasSkill 
                              ? `${skill.name} exists in ${ws.name}` 
                              : isSelected 
                                ? `Click to deselect ${skill.name} → ${ws.name}`
                                : `Click to sync ${skill.name} to ${ws.name}`
                            }
                          >
                            {hasSkill && <Check className="w-4 h-4 text-green-600" />}
                            {isSelected && !hasSkill && <div className="w-3 h-3 rounded-sm bg-primary" />}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <Layers className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">No skills found</p>
            <p className="text-sm mt-1">
              {searchQuery ? "Try a different search term" : "Create your first skill to get started"}
            </p>
          </div>
        )}
      </div>

      {/* Sync Dialog */}
      <Dialog open={syncDialogOpen} onOpenChange={setSyncDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5" />
              Sync Skills
            </DialogTitle>
            <DialogDescription>
              You are about to sync <strong>{selectedSkills.length} skills</strong> to{" "}
              <strong>{selectedWorkspaces.length} workspaces</strong>
              ({selectedCells.length} total operations)
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Summary */}
            <div className="bg-muted/50 rounded-lg p-3 space-y-2 max-h-40 overflow-auto">
              {Object.entries(selectionsBySkill).map(([skillId, wsIds]) => {
                const skill = matrixData?.skills.find((s) => s.id === skillId);
                if (!skill) return null;
                return (
                  <div key={skillId} className="flex items-center justify-between text-sm">
                    <span className="font-medium">{skill.name}</span>
                    <span className="text-muted-foreground">→ {wsIds.length} workspace{wsIds.length !== 1 ? 's' : ''}</span>
                  </div>
                );
              })}
            </div>

            {/* Options */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="overwrite"
                checked={overwriteExisting}
                onCheckedChange={(checked) => setOverwriteExisting(checked === true)}
              />
              <label htmlFor="overwrite" className="text-sm cursor-pointer">
                Overwrite existing skills with the same name
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSyncDialogOpen(false)}
              disabled={isSyncing}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSync}
              disabled={isSyncing}
            >
              {isSyncing ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ArrowRightLeft className="h-4 w-4 mr-2" />
              )}
              Sync {selectedCells.length} cells
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default SkillMatrixPage;
