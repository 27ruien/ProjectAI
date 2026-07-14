import type { SerializableRecord } from "@/lib/auth/ui-types";

export type AuthorizedReviewProject = {
  id: string;
  canReview: boolean;
};

/**
 * Applies the server-derived permission for the exact project carried by each
 * review record. Records outside the authorized project set are never returned.
 */
export function applyReviewProjectPermissions<
  T extends { projectId: string },
>(
  records: readonly T[],
  projects: readonly AuthorizedReviewProject[],
): SerializableRecord[] {
  const canReviewByProjectId = new Map(
    projects.map((project) => [project.id, project.canReview]),
  );

  return records
    .filter((record) => canReviewByProjectId.has(record.projectId))
    .map((record) =>
      JSON.parse(
        JSON.stringify({
          ...record,
          canReview: canReviewByProjectId.get(record.projectId) === true,
        }),
      ) as SerializableRecord,
    );
}
