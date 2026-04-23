package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// --- Request/Response structs for bulk operations ---

type SkillMatrixItem struct {
	SkillID         string `json:"skill_id"`
	SkillName       string `json:"skill_name"`
	SkillDescription string `json:"skill_description"`
	WorkspaceID     string `json:"workspace_id"`
	WorkspaceName   string `json:"workspace_name"`
	WorkspaceSlug   string `json:"workspace_slug"`
	HasSkill        bool   `json:"has_skill"`
	IsSource        bool   `json:"is_source"`
}

type SkillMatrixResponse struct {
	Skills     []SkillMatrixSkill     `json:"skills"`
	Workspaces []SkillMatrixWorkspace `json:"workspaces"`
	Matrix     [][]bool               `json:"matrix"` // [skill_index][workspace_index] = has_skill
}

type SkillMatrixSkill struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type SkillMatrixWorkspace struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Slug       string `json:"slug"`
	SkillCount int    `json:"skill_count"`
}

type SyncSkillRequest struct {
	TargetWorkspaceIDs []string `json:"target_workspace_ids"`
	OverwriteExisting  bool     `json:"overwrite_existing"`
}

type SyncSkillResponse struct {
	SuccessCount int      `json:"success_count"`
	FailedCount  int      `json:"failed_count"`
	FailedIDs    []string `json:"failed_ids,omitempty"`
}

type BulkCopySkillsRequest struct {
	SkillIDs           []string `json:"skill_ids"`
	SourceWorkspaceID  string   `json:"source_workspace_id"`
	TargetWorkspaceIDs []string `json:"target_workspace_ids"`
	OverwriteExisting  bool     `json:"overwrite_existing"`
}

type BulkCopySkillsResponse struct {
	CopiedCount  int      `json:"copied_count"`
	SkippedCount int      `json:"skipped_count"`
	FailedCount  int      `json:"failed_count"`
	FailedIDs    []string `json:"failed_ids,omitempty"`
}

type SkillComparisonResponse struct {
	SkillName   string                  `json:"skill_name"`
	Workspaces  []SkillWorkspaceVersion `json:"workspaces"`
	Differences []SkillDifference       `json:"differences,omitempty"`
}

type SkillWorkspaceVersion struct {
	WorkspaceID     string `json:"workspace_id"`
	WorkspaceName   string `json:"workspace_name"`
	SkillID         string `json:"skill_id"`
	Content         string `json:"content"`
	Description     string `json:"description"`
	UpdatedAt       string `json:"updated_at"`
}

type SkillDifference struct {
	WorkspaceID1 string `json:"workspace_id_1"`
	WorkspaceID2 string `json:"workspace_id_2"`
	Field        string `json:"field"`
	Same         bool   `json:"same"`
}

// --- Handler methods ---

// ListAllSkills returns all skills across all workspaces where user is a member
func (h *Handler) ListAllSkills(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	skills, err := h.Queries.ListAllSkillsForUser(r.Context(), parseUUID(userID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list skills")
		return
	}

	resp := make([]SkillResponse, len(skills))
	for i, s := range skills {
		resp[i] = skillToResponse(s)
	}

	writeJSON(w, http.StatusOK, resp)
}

// GetSkillMatrix returns a matrix view of skills vs workspaces
func (h *Handler) GetSkillMatrix(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	// Get all user's workspaces with skill counts
	workspaces, err := h.Queries.ListUserWorkspacesWithSkills(r.Context(), parseUUID(userID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list workspaces")
		return
	}

	// Get all skills across all workspaces
	skills, err := h.Queries.ListAllSkillsForUser(r.Context(), parseUUID(userID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list skills")
		return
	}

	// Build response structures
	wsList := make([]SkillMatrixWorkspace, len(workspaces))
	wsIndexMap := make(map[string]int) // workspace_id -> index
	for i, ws := range workspaces {
		wsList[i] = SkillMatrixWorkspace{
			ID:         uuidToString(ws.ID),
			Name:       ws.Name,
			Slug:       ws.Slug,
			SkillCount: int(ws.SkillCount),
		}
		wsIndexMap[uuidToString(ws.ID)] = i
	}

	// Get unique skills by name
	skillMap := make(map[string]*SkillMatrixSkill)
	for _, s := range skills {
		name := s.Name
		if _, exists := skillMap[name]; !exists {
			skillMap[name] = &SkillMatrixSkill{
				ID:          uuidToString(s.ID),
				Name:        s.Name,
				Description: s.Description,
			}
		}
	}

	skillList := make([]SkillMatrixSkill, 0, len(skillMap))
	skillIndexMap := make(map[string]int) // skill_name -> index
	i := 0
	for _, s := range skillMap {
		skillList = append(skillList, *s)
		skillIndexMap[s.Name] = i
		i++
	}

	// Build matrix [skill][workspace] = has_skill
	matrix := make([][]bool, len(skillList))
	for i := range matrix {
		matrix[i] = make([]bool, len(workspaces))
	}

	// Fill matrix
	for _, s := range skills {
		skillIdx := skillIndexMap[s.Name]
		wsIdx := wsIndexMap[uuidToString(s.WorkspaceID)]
		matrix[skillIdx][wsIdx] = true
	}

	writeJSON(w, http.StatusOK, SkillMatrixResponse{
		Skills:     skillList,
		Workspaces: wsList,
		Matrix:     matrix,
	})
}

// SyncSkillToWorkspaces copies a skill to multiple target workspaces
func (h *Handler) SyncSkillToWorkspaces(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	skillID := chi.URLParam(r, "id")

	var req SyncSkillRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Get source skill
	sourceSkill, err := h.Queries.GetSkill(r.Context(), parseUUID(skillID))
	if err != nil {
		writeError(w, http.StatusNotFound, "skill not found")
		return
	}

	// Verify user has access to source workspace
	_, err = h.Queries.GetWorkspaceMembership(r.Context(), db.GetWorkspaceMembershipParams{
		WorkspaceID: sourceSkill.WorkspaceID,
		UserID:      parseUUID(userID),
	})
	if err != nil {
		writeError(w, http.StatusForbidden, "access denied to source skill")
		return
	}

	// Get skill files
	files, err := h.Queries.ListSkillFilesWithContent(r.Context(), sourceSkill.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get skill files")
		return
	}

	successCount := 0
	failedIDs := []string{}

	// Copy to each target workspace
	for _, targetWsID := range req.TargetWorkspaceIDs {
		targetUUID := parseUUID(targetWsID)

		// Check membership in target workspace
		_, err := h.Queries.GetWorkspaceMembership(r.Context(), db.GetWorkspaceMembershipParams{
			WorkspaceID: targetUUID,
			UserID:      parseUUID(userID),
		})
		if err != nil {
			failedIDs = append(failedIDs, targetWsID)
			continue
		}

		// Skip if same workspace
		if uuidToString(sourceSkill.WorkspaceID) == targetWsID {
			continue
		}

		// Copy skill
		newSkill, err := h.Queries.CopySkillToWorkspace(r.Context(), db.CopySkillToWorkspaceParams{
			ID:          sourceSkill.ID,
			WorkspaceID: targetUUID,
			CreatedBy:   parseUUID(userID),
			Column4:     req.OverwriteExisting,
		})
		if err != nil {
			failedIDs = append(failedIDs, targetWsID)
			continue
		}

		// Copy files if skill was created or updated
		if len(files) > 0 {
			err = h.Queries.CopySkillFiles(r.Context(), db.CopySkillFilesParams{
				SkillID:   sourceSkill.ID,
				SkillID_2: newSkill.ID,
			})
			if err != nil {
				// Log error but don't fail the whole operation
				slog.Error("failed to copy skill files", "error", err, "skill_id", skillID)
			}
		}

		successCount++

		// Publish event
		actorType, actorID := h.resolveActor(r, userID, targetWsID)
		h.publish(protocol.EventSkillCreated, targetWsID, actorType, actorID, map[string]any{
			"skill": skillToResponse(newSkill),
		})
	}

	writeJSON(w, http.StatusOK, SyncSkillResponse{
		SuccessCount: successCount,
		FailedCount:  len(failedIDs),
		FailedIDs:    failedIDs,
	})
}

// BulkCopySkills copies multiple skills from one workspace to others
func (h *Handler) BulkCopySkills(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	var req BulkCopySkillsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.SourceWorkspaceID == "" || len(req.SkillIDs) == 0 || len(req.TargetWorkspaceIDs) == 0 {
		writeError(w, http.StatusBadRequest, "source_workspace_id, skill_ids, and target_workspace_ids are required")
		return
	}

	// Verify access to source workspace
	_, err := h.Queries.GetWorkspaceMembership(r.Context(), db.GetWorkspaceMembershipParams{
		WorkspaceID: parseUUID(req.SourceWorkspaceID),
		UserID:      parseUUID(userID),
	})
	if err != nil {
		writeError(w, http.StatusForbidden, "access denied to source workspace")
		return
	}

	copiedCount := 0
	skippedCount := 0
	failedIDs := []string{}

	// Copy each skill
	for _, skillID := range req.SkillIDs {
		skillUUID := parseUUID(skillID)

		// Get skill from source workspace
		skill, err := h.Queries.GetSkillInWorkspace(r.Context(), db.GetSkillInWorkspaceParams{
			ID:          skillUUID,
			WorkspaceID: parseUUID(req.SourceWorkspaceID),
		})
		if err != nil {
			failedIDs = append(failedIDs, skillID)
			continue
		}

		// Get skill files
		files, err := h.Queries.ListSkillFilesWithContent(r.Context(), skill.ID)
		if err != nil {
			failedIDs = append(failedIDs, skillID)
			continue
		}

		// Copy to each target workspace
		skillCopied := false
		for _, targetWsID := range req.TargetWorkspaceIDs {
			if targetWsID == req.SourceWorkspaceID {
				continue
			}

			targetUUID := parseUUID(targetWsID)

			// Check membership
			_, err := h.Queries.GetWorkspaceMembership(r.Context(), db.GetWorkspaceMembershipParams{
				WorkspaceID: targetUUID,
				UserID:      parseUUID(userID),
			})
			if err != nil {
				continue
			}

			// Check if skill exists in target
			_, err = h.Queries.GetSkillByNameInWorkspace(r.Context(), db.GetSkillByNameInWorkspaceParams{
				WorkspaceID: targetUUID,
				Name:        skill.Name,
			})

			if err == nil && !req.OverwriteExisting {
				skippedCount++
				continue
			}

			// Copy skill
			newSkill, err := h.Queries.CopySkillToWorkspace(r.Context(), db.CopySkillToWorkspaceParams{
				ID:          skill.ID,
				WorkspaceID: targetUUID,
				CreatedBy:   parseUUID(userID),
				Column4:     req.OverwriteExisting,
			})
			if err != nil {
				continue
			}

			// Copy files
			if len(files) > 0 {
				h.Queries.CopySkillFiles(r.Context(), db.CopySkillFilesParams{
					SkillID:   skill.ID,
					SkillID_2: newSkill.ID,
				})
			}

			actorType, actorID := h.resolveActor(r, userID, targetWsID)
			h.publish(protocol.EventSkillCreated, targetWsID, actorType, actorID, map[string]any{
				"skill": skillToResponse(newSkill),
			})

			skillCopied = true
		}

		if skillCopied {
			copiedCount++
		}
	}

	writeJSON(w, http.StatusOK, BulkCopySkillsResponse{
		CopiedCount:  copiedCount,
		SkippedCount: skippedCount,
		FailedCount:  len(failedIDs),
		FailedIDs:    failedIDs,
	})
}

// CompareSkillAcrossWorkspaces compares a skill's content across workspaces
func (h *Handler) CompareSkillAcrossWorkspaces(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	skillName := r.URL.Query().Get("name")
	if skillName == "" {
		writeError(w, http.StatusBadRequest, "name query parameter is required")
		return
	}

	// Get all skills with this name across user's workspaces
	skills, err := h.Queries.GetSkillsByNameAcrossWorkspaces(r.Context(), db.GetSkillsByNameAcrossWorkspacesParams{
		Name:   skillName,
		UserID: parseUUID(userID),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get skills")
		return
	}

	if len(skills) == 0 {
		writeError(w, http.StatusNotFound, "skill not found")
		return
	}

	// Build response
	versions := make([]SkillWorkspaceVersion, len(skills))
	for i, s := range skills {
		versions[i] = SkillWorkspaceVersion{
			WorkspaceID:   uuidToString(s.WorkspaceID),
			WorkspaceName: s.WorkspaceName,
			SkillID:       uuidToString(s.ID),
			Content:       s.Content,
			Description:   s.Description,
			UpdatedAt:     timestampToString(s.UpdatedAt),
		}
	}

	// Calculate differences
	differences := []SkillDifference{}
	for i := 0; i < len(versions); i++ {
		for j := i + 1; j < len(versions); j++ {
			v1, v2 := versions[i], versions[j]

			contentSame := v1.Content == v2.Content
			descSame := v1.Description == v2.Description

			differences = append(differences, SkillDifference{
				WorkspaceID1: v1.WorkspaceID,
				WorkspaceID2: v2.WorkspaceID,
				Field:        "content",
				Same:         contentSame,
			})

			if !descSame {
				differences = append(differences, SkillDifference{
					WorkspaceID1: v1.WorkspaceID,
					WorkspaceID2: v2.WorkspaceID,
					Field:        "description",
					Same:         descSame,
				})
			}
		}
	}

	writeJSON(w, http.StatusOK, SkillComparisonResponse{
		SkillName:   skillName,
		Workspaces:  versions,
		Differences: differences,
	})
}
