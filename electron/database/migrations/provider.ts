// SPDX-License-Identifier: Apache-2.0

import type { MigrationProvider, Migration } from 'kysely'
import * as m001 from './001_create_issues'
import * as m002 from './002_create_inbox'
import * as m003 from './003_create_managed_sessions'
import * as m004 from './004_create_projects'
import * as m005 from './005_merge_preferences_into_projects'
import * as m006 from './006_create_artifacts'
import * as m007 from './007_create_session_notes'
import * as m008 from './008_add_issue_read_tracking'
import * as m009 from './009_create_browser_profiles'
import * as m010 from './010_add_session_notes_images'
import * as m011 from './011_create_issue_views'
import * as m012 from './012_create_schedules'
import * as m013 from './013_create_schedule_executions'
import * as m014 from './014_create_schedule_pipelines'
import * as m015 from './015_add_session_origin'
import * as m016 from './016_drop_session_issue_id'
import * as m017 from './017_add_origin_extra'
import * as m018 from './018_create_issue_context_refs'
import * as m019 from './019_make_artifact_session_nullable'
import * as m020 from './020_add_session_project_id'
import * as m021 from './021_seed_builtin_labels'
import * as m022 from './022_create_capacity_tables'
import * as m023 from './023_capacity_state_project_id'
import * as m024 from './024_normalize_capacity_paths'
import * as m025 from './025_add_market_provenance'
import * as m026 from './026_add_display_order'
import * as m027 from './027_add_notes_rich_content'
import * as m028 from './028_add_issue_rich_content'
import * as m029 from './029_add_session_queued_messages'
import * as m030 from './030_drop_session_queued_messages'
import * as m031 from './031_rename_capacity_to_capability'
import * as m032 from './032_add_session_active_duration'
import * as m033 from './033_create_installed_packages'
import * as m034 from './034_create_repo_sources'
import * as m035 from './035_add_session_execution_context'
import * as m036 from './036_add_engine_kind_to_managed_sessions'
import * as m037 from './037_create_project_external_mappings'
import * as m038 from './038_backfill_project_external_mappings_from_claude'
import * as m039 from './039_add_inbox_navigation_target'
import * as m040 from './040_add_managed_session_ref_index'
import * as m041 from './041_create_memory_tables'
import * as m042 from './042_add_memory_extraction_delay'
import * as m043 from './043_create_issue_providers'
import * as m044 from './044_extend_issues_for_remote'
import * as m045 from './045_create_issue_change_queue'
import * as m046 from './046_create_issue_comments'
import * as m047 from './047_create_issue_sync_logs'
import * as m048 from './048_extend_issues_for_phase2'
import * as m049 from './049_extend_issue_providers_for_phase2'
import * as m050 from './050_extend_issue_providers_for_linear'
import * as m051 from './051_add_project_preferences'
import * as m052 from './052_add_project_browser_state_policy'
import * as m053 from './053_create_session_lifecycle_operations'

/**
 * Compile-time migration provider.
 *
 * All migrations are statically imported so Electron's asar bundle
 * doesn't need to resolve file-system paths at runtime.
 *
 * To add a new migration:
 * 1. Create `NNN_description.ts` with up/down exports
 * 2. Import it here and register in the record below
 */
class CodeMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return {
      '001_create_issues': m001,
      '002_create_inbox': m002,
      '003_create_managed_sessions': m003,
      '004_create_projects': m004,
      '005_merge_preferences_into_projects': m005,
      '006_create_artifacts': m006,
      '007_create_session_notes': m007,
      '008_add_issue_read_tracking': m008,
      '009_create_browser_profiles': m009,
      '010_add_session_notes_images': m010,
      '011_create_issue_views': m011,
      '012_create_schedules': m012,
      '013_create_schedule_executions': m013,
      '014_create_schedule_pipelines': m014,
      '015_add_session_origin': m015,
      '016_drop_session_issue_id': m016,
      '017_add_origin_extra': m017,
      '018_create_issue_context_refs': m018,
      '019_make_artifact_session_nullable': m019,
      '020_add_session_project_id': m020,
      '021_seed_builtin_labels': m021,
      '022_create_capacity_tables': m022,
      '023_capacity_state_project_id': m023,
      '024_normalize_capacity_paths': m024,
      '025_add_market_provenance': m025,
      '026_add_display_order': m026,
      '027_add_notes_rich_content': m027,
      '028_add_issue_rich_content': m028,
      '029_add_session_queued_messages': m029,
      '030_drop_session_queued_messages': m030,
      '031_rename_capacity_to_capability': m031,
      '032_add_session_active_duration': m032,
      '033_create_installed_packages': m033,
      '034_create_repo_sources': m034,
      '035_add_session_execution_context': m035,
      '036_add_engine_kind_to_managed_sessions': m036,
      '037_create_project_external_mappings': m037,
      '038_backfill_project_external_mappings_from_claude': m038,
      '039_add_inbox_navigation_target': m039,
      '040_add_managed_session_ref_index': m040,
      '041_create_memory_tables': m041,
      '042_add_memory_extraction_delay': m042,
      '043_create_issue_providers': m043,
      '044_extend_issues_for_remote': m044,
      '045_create_issue_change_queue': m045,
      '046_create_issue_comments': m046,
      '047_create_issue_sync_logs': m047,
      '048_extend_issues_for_phase2': m048,
      '049_extend_issue_providers_for_phase2': m049,
      '050_extend_issue_providers_for_linear': m050,
      '051_add_project_preferences': m051,
      '052_add_project_browser_state_policy': m052,
      '053_create_session_lifecycle_operations': m053,
    }
  }
}

export const migrationProvider = new CodeMigrationProvider()
