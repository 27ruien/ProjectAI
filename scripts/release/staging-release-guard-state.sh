#!/usr/bin/env bash
# Shared, dependency-free state machine for the Staging release transaction.
# Callers supply log_release_event(event, check, exit_code, error_code) when
# persistent evidence is required. This file never handles credentials.

release_guard_emit() {
  if declare -F log_release_event >/dev/null 2>&1; then
    log_release_event "$@"
  fi
}

release_guard_init() {
  release_phase="INITIALIZING"
  release_committed=0
  release_error_code="STAGING_RELEASE_UNCLASSIFIED_FAILURE"
  release_failure_logged=0
  release_guard_emit "PHASE" "$release_phase" "0" "NONE"
}

release_guard_set_phase() {
  local next_phase="$1"
  [[ "$next_phase" =~ ^[A-Z][A-Z0-9_]{2,80}$ ]]
  release_phase="$next_phase"
  release_error_code="STAGING_RELEASE_UNCLASSIFIED_FAILURE"
  release_failure_logged=0
  release_guard_emit "PHASE" "$release_phase" "0" "NONE"
}

release_guard_run_check() {
  local check_name="$1"
  local failure_code="$2"
  local status
  shift 2

  [[ "$check_name" =~ ^[A-Z][A-Z0-9_]{2,80}$ ]]
  [[ "$failure_code" =~ ^STAGING_[A-Z0-9_]{3,120}$ ]]

  set +e
  "$@"
  status=$?
  set -e

  if [[ "$status" -eq 0 ]]; then
    release_guard_emit "PASS" "$check_name" "$status" "NONE"
    return 0
  fi

  release_error_code="$failure_code"
  release_failure_logged=1
  release_guard_emit "FAIL" "$check_name" "$status" "$failure_code"
  return "$status"
}

release_guard_record_unhandled_failure() {
  local status="$1"
  [[ "$status" =~ ^[1-9][0-9]*$ ]] || return 0
  [[ "$release_failure_logged" == "1" ]] && return 0

  release_failure_logged=1
  release_guard_emit "FAIL" "$release_phase" "$status" "$release_error_code"
}

release_guard_mark_committed() {
  release_committed=1
  release_guard_emit "COMMIT" "RELEASE_TRANSACTION" "0" "STAGING_RELEASE_COMMITTED"
}

release_guard_should_rollback() {
  local exit_code="$1"
  [[ "$exit_code" =~ ^[0-9]+$ ]]
  [[ "$exit_code" -ne 0 && "$release_committed" -ne 1 ]]
}
