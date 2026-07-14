import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyReviewProjectPermissions } from "../../lib/project-data/review-permissions";

describe("per-project review permissions", () => {
  it("keeps readable reviews but annotates each exact project as editable or read-only", () => {
    const source = [
      { id: "review-a", projectId: "project-a", title: "A" },
      { id: "review-b", projectId: "project-b", title: "B" },
      { id: "review-c", projectId: "project-c", title: "C" },
    ];

    const result = applyReviewProjectPermissions(source, [
      { id: "project-a", canReview: true },
      { id: "project-b", canReview: false },
    ]);

    assert.deepEqual(result, [
      {
        id: "review-a",
        projectId: "project-a",
        title: "A",
        canReview: true,
      },
      {
        id: "review-b",
        projectId: "project-b",
        title: "B",
        canReview: false,
      },
    ]);
    assert.equal("canReview" in source[0], false, "source fixtures remain immutable");
  });
});
