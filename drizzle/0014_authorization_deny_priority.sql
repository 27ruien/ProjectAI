CREATE OR REPLACE FUNCTION "projectai_authorized_documents"(
	"actor_id" text,
	"target_project_id" text,
	"requested_permission" "knowledge_permission"
)
RETURNS TABLE (
	"document_id" text,
	"source_project_id" text,
	"knowledge_space_id" text,
	"source_scope" "knowledge_space_type"
)
LANGUAGE sql
STABLE
AS $$
WITH target_context AS (
	SELECT
		p.id AS project_id,
		p.organization_id,
		p.department_id,
		u.system_role,
		pm.role AS project_role
	FROM projects p
	JOIN users u ON u.id = actor_id AND u.status = 'active'
	LEFT JOIN organization_members om
		ON om.organization_id = p.organization_id
		AND om.user_id = actor_id
		AND om.is_active
	LEFT JOIN project_members pm
		ON pm.project_id = p.id AND pm.user_id = actor_id
	WHERE p.id = target_project_id
		AND (
			u.system_role = 'system_admin'
			OR pm.user_id IS NOT NULL
		)
), actor_roles AS (
	SELECT tc.organization_id, tc.department_id, role_name
	FROM target_context tc
	CROSS JOIN LATERAL (
		VALUES
			(tc.project_role::text),
			((SELECT om.role::text FROM organization_members om
				WHERE om.organization_id = tc.organization_id
					AND om.user_id = actor_id AND om.is_active LIMIT 1)),
			((SELECT dm.role::text FROM department_members dm
				WHERE dm.department_id = tc.department_id
					AND dm.organization_id = tc.organization_id
					AND dm.user_id = actor_id AND dm.is_active LIMIT 1))
	) AS roles(role_name)
	WHERE role_name IS NOT NULL
), candidate_documents AS (
	SELECT DISTINCT
		d.id AS document_id,
		d.project_id AS source_project_id,
		d.knowledge_space_id,
		ks.space_type AS source_scope,
		d.visibility,
		ks.project_id AS space_project_id,
		source_project.department_id AS source_department_id,
		ks.organization_id,
		tc.project_id AS target_project_id,
		tc.department_id AS target_department_id,
		tc.project_role,
		tc.system_role
	FROM target_context tc
	JOIN knowledge_spaces ks
		ON ks.organization_id = tc.organization_id AND ks.is_active
	JOIN project_documents d
		ON d.knowledge_space_id = ks.id
	JOIN projects source_project
		ON source_project.id = d.project_id
		AND source_project.organization_id = tc.organization_id
	WHERE
		ks.project_id = tc.project_id
		OR EXISTS (
			SELECT 1 FROM project_knowledge_sources pks
			WHERE pks.project_id = tc.project_id AND pks.is_active
				AND (
					(pks.source_type = 'knowledge_space' AND pks.knowledge_space_id = ks.id)
					OR (pks.source_type = 'document' AND pks.document_id = d.id)
				)
		)
		OR EXISTS (
			SELECT 1
			FROM document_grants direct_document_grant
			WHERE direct_document_grant.document_id = d.id
				AND direct_document_grant.organization_id = tc.organization_id
				AND direct_document_grant.subject_type = 'project'
				AND direct_document_grant.subject_id = tc.project_id
				AND direct_document_grant.permission = requested_permission
				AND direct_document_grant.effect = 'allow'
		)
		OR EXISTS (
			SELECT 1
			FROM knowledge_space_grants direct_space_grant
			WHERE direct_space_grant.knowledge_space_id = ks.id
				AND direct_space_grant.organization_id = tc.organization_id
				AND direct_space_grant.subject_type = 'project'
				AND direct_space_grant.subject_id = tc.project_id
				AND direct_space_grant.permission = requested_permission
				AND direct_space_grant.effect = 'allow'
		)
		OR (
			d.visibility = 'department_shared'
			AND tc.department_id IS NOT NULL
			AND source_project.department_id = tc.department_id
		)
		OR d.visibility = 'organization_shared'
), all_rules AS (
	SELECT
		dg.document_id,
		NULL::text AS knowledge_space_id,
		dg.organization_id,
		dg.effect,
		dg.subject_type,
		dg.subject_id
	FROM document_grants dg
	WHERE dg.permission = requested_permission
	UNION ALL
	SELECT
		NULL::text AS document_id,
		ksg.knowledge_space_id,
		ksg.organization_id,
		ksg.effect,
		ksg.subject_type,
		ksg.subject_id
	FROM knowledge_space_grants ksg
	WHERE ksg.permission = requested_permission
), matching_rules AS (
	SELECT
		cd.document_id,
		arule.effect,
		arule.subject_type,
		arule.subject_id
	FROM candidate_documents cd
	JOIN all_rules arule
		ON arule.organization_id = cd.organization_id
		AND (
			arule.document_id = cd.document_id
			OR arule.knowledge_space_id = cd.knowledge_space_id
		)
	WHERE
		CASE arule.subject_type
			WHEN 'user' THEN arule.subject_id = actor_id
			WHEN 'project' THEN arule.subject_id = cd.target_project_id
			WHEN 'department' THEN arule.subject_id = cd.target_department_id
			WHEN 'organization' THEN arule.subject_id = cd.organization_id
			WHEN 'role' THEN EXISTS (
				SELECT 1 FROM actor_roles ar
				WHERE ar.role_name = arule.subject_id
			)
			ELSE false
		END
), explicit_access AS (
	SELECT
		cd.document_id,
		bool_or(mr.effect = 'deny') AS denied,
		bool_or(mr.effect = 'allow') AS allowed
	FROM candidate_documents cd
	LEFT JOIN matching_rules mr ON mr.document_id = cd.document_id
	GROUP BY cd.document_id
), member_access AS (
	SELECT
		cd.document_id,
		CASE requested_permission
			WHEN 'view' THEN cd.project_role IS NOT NULL
			WHEN 'download' THEN cd.project_role IS NOT NULL
			WHEN 'upload' THEN cd.space_project_id = cd.target_project_id
				AND cd.project_role IN ('project_manager', 'project_member')
			WHEN 'edit_metadata' THEN cd.space_project_id = cd.target_project_id
				AND cd.project_role IN ('project_manager', 'project_member')
			WHEN 'manage_versions' THEN cd.space_project_id = cd.target_project_id
				AND cd.project_role IN ('project_manager', 'project_member')
			WHEN 'archive' THEN cd.space_project_id = cd.target_project_id
				AND cd.project_role = 'project_manager'
			WHEN 'manage_permissions' THEN cd.project_role = 'project_manager'
			WHEN 'manage_members' THEN cd.project_role = 'project_manager'
			ELSE false
		END AS allowed
	FROM candidate_documents cd
)
SELECT
	cd.document_id,
	cd.source_project_id,
	cd.knowledge_space_id,
	cd.source_scope
FROM candidate_documents cd
JOIN explicit_access ea ON ea.document_id = cd.document_id
JOIN member_access ma ON ma.document_id = cd.document_id
WHERE
	coalesce(ea.denied, false) = false
	AND (
		cd.system_role = 'system_admin'
		OR coalesce(ea.allowed, false)
		OR (
			cd.visibility <> 'restricted'
			AND ma.allowed
		)
		OR EXISTS (
			SELECT 1 FROM knowledge_space_members ksm
			WHERE ksm.knowledge_space_id = cd.knowledge_space_id
				AND ksm.user_id = actor_id AND ksm.is_active
				AND CASE requested_permission
					WHEN 'view' THEN true
					WHEN 'download' THEN ksm.role IN ('manager', 'editor')
					ELSE ksm.role = 'manager'
				END
		)
	)
$$;
--> statement-breakpoint
COMMENT ON FUNCTION "projectai_authorized_documents"(text, text, "knowledge_permission") IS
'Central default-deny document scope. Matching explicit deny wins for every actor, including system administrators; callers must still revalidate citations and resource writes.';
