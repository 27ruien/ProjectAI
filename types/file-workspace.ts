export interface ProjectDocumentFolderDto {
  id: string;
  projectId: string;
  knowledgeSpaceId: string;
  parentFolderId: string | null;
  name: string;
  createdBy: { displayName: string };
  createdAt: string;
  updatedAt: string;
  permissions: {
    canEdit: boolean;
    canDelete: boolean;
  };
}

export interface ProjectFolderListResponse {
  folders: ProjectDocumentFolderDto[];
}
