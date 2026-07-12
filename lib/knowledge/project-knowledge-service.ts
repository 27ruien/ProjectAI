import type {
  ProjectKnowledgeSearchInput,
  ProjectKnowledgeSearchResult,
  ProjectQuestionInput,
  ProjectQuestionResult,
  SourceCitation,
} from "@/types";

export interface ProjectKnowledgeService {
  searchProjectKnowledge(
    input: ProjectKnowledgeSearchInput,
  ): Promise<ProjectKnowledgeSearchResult>;

  answerProjectQuestion(
    input: ProjectQuestionInput,
  ): Promise<ProjectQuestionResult>;

  getDocumentCitations(sourceIds: string[]): Promise<SourceCitation[]>;
}
