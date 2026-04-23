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
  Trash2,
} from "lucide-react";
import type {
  SkillMatrixResponse,
  SkillMatrixSkill,
  SkillMatrixWorkspace,
} from "@multica/core/types";
import { api } from "@multica/core/api";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
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
  skillName: string;  // For display/identification
  skillId: string;     // Actual skill ID for API calls
  workspaceId: string;
  exists: boolean;
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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

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

  // Find actual skill ID for a skill name in a specific workspace
  // Use the skill_lookup map from the API response
  const findSkillIdForWorkspace = (skillName: string, wsId: string): string | null => {
    if (!matrixData) return null;
    return matrixData.skill_lookup?.[skillName]?.[wsId] ?? null;
  };

  // Check if cell is selected
  const isCellSelected = (skillName: string, wsId: string) => {
    return selectedCells.some((c) => c.skillName === skillName && c.workspaceId === wsId);
  };

  // Toggle cell selection
  const toggleCell = (skillName: string, wsId: string, exists: boolean) => {
    // Find the actual skill ID for this workspace
    const skillId = exists 
      ? findSkillIdForWorkspace(skillName, wsId)  // For delete: get the skill ID in this workspace
      : matrixData?.skills.find((s) => s.name === skillName)?.id ?? null;  // For sync: get any source skill
    
    if (!skillId) return;
    
    setSelectedCells((prev) => {
      const existing = prev.find((c) => c.skillName === skillName && c.workspaceId === wsId);
      if (existing) {
        return prev.filter((c) => !(c.skillName === skillName && c.workspaceId === wsId));
      }
      return [...prev, { skillName, skillId, workspaceId: wsId, exists }];
    });
  };

  // Get selections by operation type
  const syncSelections = selectedCells.filter((c) => !c.exists);
  const deleteSelections = selectedCells.filter((c) => c.exists);

  // Get unique skills for each operation
  const skillsToSync = useMemo(() => {
    if (!matrixData) return [];
    const skillIds = [...new Set(syncSelections.map((c) => c.skillId))];
    return skillIds
      .map((id) => matrixData.skills.find((s) => s.id === id))
      .filter(Boolean) as SkillMatrixSkill[];
  }, [syncSelections, matrixData]);

  const skillsToDelete = useMemo(() => {
    if (!matrixData) return [];
    const skillIds = [...new Set(deleteSelections.map((c) => c.skillId))];
    return skillIds
      .map((id) => matrixData.skills.find((s) => s.id === id))
      .filter(Boolean) as SkillMatrixSkill[];
  }, [deleteSelections, matrixData]);

  // Group sync selections by skill
  const syncBySkill = useMemo(() => {
    const grouped: Record<string, string[]> = {};
    syncSelections.forEach((cell) => {
      if (!grouped[cell.skillId]) grouped[cell.skillId] = [];
      grouped[cell.skillId].push(cell.workspaceId);
    });
    return grouped;
  }, [syncSelections]);

  // Group delete selections by skill
  const deleteBySkill = useMemo(() => {
    const grouped: Record<string, string[]> = {};
    deleteSelections.forEach((cell) => {
      if (!grouped[cell.skillId]) grouped[cell.skillId] = [];
      grouped[cell.skillId].push(cell.workspaceId);
    });
    return grouped;
  }, [deleteSelections]);

  // Helper to get workspace name by ID
  const getWorkspaceName = (wsId: string) => {
    return matrixData?.workspaces.find((w) => w.id === wsId)?.name ?? wsId;
  };

  // Handle sync
  const handleSync = async () => {
    if (syncSelections.length === 0 || !matrixData) return;

    setIsProcessing(true);
    let totalSuccess = 0;
    let totalFailed = 0;

    for (const [skillId, workspaceIds] of Object.entries(syncBySkill)) {
      try {
        const result = await api.syncSkillToWorkspaces(skillId, {
          target_workspace_ids: workspaceIds,
          overwrite_existing: false,
        });
        totalSuccess += result.success_count;
        totalFailed += result.failed_count;
      } catch {
        totalFailed += workspaceIds.length;
      }
    }

    if (totalSuccess > 0) {
      toast.success(`Synced ${skillsToSync.length} skills to ${totalSuccess} workspaces`);
    }
    if (totalFailed > 0) {
      toast.error(`Failed to sync ${totalFailed} workspaces`);
    }

    queryClient.invalidateQueries({ queryKey: skillMatrixKeys.all });
    setSelectedCells([]);
    setSyncDialogOpen(false);
    setIsProcessing(false);
  };

  // Handle delete
  const handleDelete = async () => {
    if (deleteSelections.length === 0) return;

    setIsProcessing(true);
    
    const skillIdsToDelete = [...new Set(deleteSelections.map((c) => c.skillId))];
    
    try {
      const result = await api.bulkDeleteSkills({ skill_ids: skillIdsToDelete });
      
      if (result.deleted_count > 0) {
        toast.success(`Deleted ${result.deleted_count} skills`);
      }
      if (result.failed_count > 0) {
        toast.error(`Failed to delete ${result.failed_count} skills`);
      }
      
      queryClient.invalidateQueries({ queryKey: skillMatrixKeys.all });
      setSelectedCells([]);
      setDeleteDialogOpen(false);
    } catch {
      toast.error("Failed to delete skills");
    }
    
    setIsProcessing(false);
  };

  // Clear all selections
  const clearSelection = () => {
    setSelectedCells([]);
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Skill Matrix"
        description="Click cells to sync (add) or delete skills across workspaces"
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
      <div className="flex items-center justify-between px-6 py-4 border-b">
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
              <Badge variant="secondary">{selectedCells.length} selected</Badge>
              {syncSelections.length > 0 && (
                <Badge variant="outline" className="text-primary border-primary">
                  {syncSelections.length} to sync
                </Badge>
              )}
              {deleteSelections.length > 0 && (
                <Badge variant="outline" className="text-destructive border-destructive">
                  {deleteSelections.length} to delete
                </Badge>
              )}
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {syncSelections.length > 0 && (
            <Button
              variant="default"
              size="sm"
              onClick={() => setSyncDialogOpen(true)}
            >
              <ArrowRightLeft className="h-4 w-4 mr-2" />
              Sync {syncSelections.length}
            </Button>
          )}
          {deleteSelections.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete {deleteSelections.length}
            </Button>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 px-6 py-3 border-b bg-muted/50 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Check className="w-4 h-4 text-green-600" />
          <span>Exists (click to delete)</span>
        </div>
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="w-4 h-4 text-primary" />
          <span>Selected for sync</span>
        </div>
        <div className="flex items-center gap-2">
          <Trash2 className="w-4 h-4 text-destructive" />
          <span>Selected for delete</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border border-muted-foreground/30 rounded" />
          <span>Not present (click to sync)</span>
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
          <div className="border rounded-lg overflow-hidden">
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
                  <tr key={skill.id} className="hover:bg-muted/30">
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
                      const isSelected = isCellSelected(skill.name, ws.id);
                      const selection = selectedCells.find((c) => c.skillName === skill.name && c.workspaceId === ws.id);
                      const isDelete = selection?.exists ?? false;
                      
                      return (
                        <td key={ws.id} className="p-2 text-center">
                          <button
                            onClick={() => toggleCell(skill.name, ws.id, hasSkill)}
                            className={`
                              w-8 h-8 rounded transition-all flex items-center justify-center
                              ${hasSkill 
                                ? isSelected
                                  ? "bg-destructive/10 ring-2 ring-destructive"
                                  : "bg-green-500/10 hover:bg-destructive/10"
                                : isSelected
                                  ? "bg-primary/10 ring-2 ring-primary"
                                  : "hover:bg-muted border border-muted"
                              }
                            `}
                            title={hasSkill 
                              ? isSelected
                                ? `Cancel deletion of ${skill.name} from ${ws.name}`
                                : `Delete ${skill.name} from ${ws.name}`
                              : isSelected 
                                ? `Cancel sync of ${skill.name} to ${ws.name}`
                                : `Sync ${skill.name} to ${ws.name}`
                            }
                          >
                            {hasSkill && !isSelected && <Check className="w-4 h-4 text-green-600" />}
                            {hasSkill && isSelected && <Trash2 className="w-4 h-4 text-destructive" />}
                            {!hasSkill && isSelected && <ArrowRightLeft className="w-4 h-4 text-primary" />}
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
              You are about to add <strong>{skillsToSync.length} skills</strong> to{" "}
              <strong>{syncSelections.length} workspaces</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="bg-muted rounded-lg p-3 space-y-3 max-h-48 overflow-auto">
              {Object.entries(syncBySkill).map(([skillId, wsIds]) => {
                const skill = matrixData?.skills.find((s) => s.id === skillId);
                if (!skill) return null;
                return (
                  <div key={skillId} className="space-y-1">
                    <div className="font-medium text-sm">{skill.name}</div>
                    <div className="text-xs text-muted-foreground pl-2">
                      → {wsIds.map(getWorkspaceName).join(", ")}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSyncDialogOpen(false)}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSync}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ArrowRightLeft className="h-4 w-4 mr-2" />
              )}
              Sync {syncSelections.length} cells
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete Skills
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{skillsToDelete.length} skills</strong>?{" "}
              This will remove them from <strong>{deleteSelections.length} workspaces</strong>.
              <br /><br />
              <span className="text-destructive font-medium">This action cannot be undone.</span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="bg-muted rounded-lg p-3 space-y-3 max-h-48 overflow-auto border border-destructive/20">
              {Object.entries(deleteBySkill).map(([skillId, wsIds]) => {
                const skill = matrixData?.skills.find((s) => s.id === skillId);
                if (!skill) return null;
                return (
                  <div key={skillId} className="space-y-1">
                    <div className="font-medium text-sm">{skill.name}</div>
                    <div className="text-xs text-muted-foreground pl-2">
                      → {wsIds.map(getWorkspaceName).join(", ")}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Delete {skillsToDelete.length} skills
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default SkillMatrixPage;
