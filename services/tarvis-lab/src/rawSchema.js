export const RAW_BACKUP_TABLE_COLUMNS = Object.freeze({
  glucose_readings: ["id", "source_id", "timestamp_ms", "received_at_ms", "mmol_l", "trend", "quality", "source_factory_timestamp", "source_local_timestamp", "timestamp_discrepancy_minutes", "imported_at_ms", "source_file", "source_row", "source_device_id"],
  source_sync_state: ["source_id", "last_attempt_at_ms", "last_success_at_ms", "last_error_code", "last_error_message", "record_count"],
  insulin_basal: ["id", "source_id", "start_ms", "end_ms", "rate_units_per_hour", "units", "delivery_type", "percentage", "units_estimated", "imported_at_ms", "source_file", "source_row", "source_device_id"],
  insulin_bolus: ["id", "source_id", "timestamp_ms", "units", "delivery_type", "blood_glucose_input_mmol_l", "carbs_input_grams", "carb_ratio_grams_per_unit", "initial_units", "extended_units", "imported_at_ms", "source_file", "source_row", "source_device_id"],
  context_events: ["id", "source_id", "origin", "kind", "start_ms", "end_ms", "title", "meal_type", "carbs_grams", "energy_kcal", "protein_grams", "fat_grams", "fibre_grams", "sugars_grams", "saturated_fat_grams", "serving_quantity", "serving_count", "activity_type", "duration_minutes", "intensity", "calories_burned", "quality_percent", "kilograms", "amount", "unit", "medication_type", "recorded_at_ms", "source_file", "source_row"],
  hevy_workouts: ["id", "context_event_id", "title", "description", "start_ms", "end_ms", "updated_at_ms", "created_at_ms", "payload_json", "imported_at_ms"],
  health_connect_records: ["id", "external_id", "parent_external_id", "kind", "source_package", "start_ms", "end_ms", "last_modified_ms", "recording_method", "value", "unit", "payload_json", "imported_at_ms"],
  health_connect_sources: ["package_name", "display_name", "first_seen_at_ms", "last_seen_at_ms"],
  health_connect_preferences: ["category", "enabled", "preferred_source_package", "preferred_source_mode", "updated_at_ms"],
  health_connect_sync_state: ["category", "last_attempt_at_ms", "last_success_at_ms", "data_start_ms", "data_through_ms", "record_count", "last_error_code", "last_error_message"],
  food_catalog_cache: ["id", "provider", "external_id", "barcode", "name", "brand", "image_url", "basis_amount", "basis_unit", "default_serving_amount", "default_serving_unit", "last_portion_amount", "last_portion_unit", "carbohydrate_grams", "energy_kcal", "protein_grams", "fat_grams", "fibre_grams", "sugars_grams", "saturated_fat_grams", "nutrition_quality_json", "source_label", "source_url", "raw_payload_json", "cached_at_ms", "expires_at_ms", "is_favorite", "use_count", "last_used_at_ms"],
  food_logs: ["id", "context_event_id", "timestamp_ms", "meal_type", "title", "carbohydrate_grams", "energy_kcal", "protein_grams", "fat_grams", "fibre_grams", "sugars_grams", "saturated_fat_grams", "created_at_ms", "updated_at_ms", "is_favorite"],
  food_log_items: ["id", "food_log_id", "ordinal", "catalog_id", "provider", "external_id", "name_snapshot", "brand_snapshot", "barcode_snapshot", "amount", "unit", "carbohydrate_grams", "energy_kcal", "protein_grams", "fat_grams", "fibre_grams", "sugars_grams", "saturated_fat_grams", "source_label", "source_url"],
  import_batches: ["id", "source_id", "file_name", "file_sha256", "imported_at_ms", "data_start_ms", "data_through_ms", "basal_count", "bolus_count", "context_count", "daily_total_count", "duplicate_count", "skipped_count", "warnings_json"],
  import_source_payloads: ["import_batch_id", "source_id", "file_name", "file_sha256", "format", "byte_length", "manifest_json", "payload_base64", "stored_at_ms"],
  notification_source_events: ["id", "package_name", "posted_at_ms", "notification_when_ms", "received_at_ms", "is_ongoing", "payload_json", "parser_version", "parsed_glucose_id", "parsed_iob_units", "parsed_pump_mode", "imported_at_ms"],
  insight_reports: ["id", "kind", "period_start_ms", "period_end_ms", "comparison_start_ms", "comparison_end_ms", "generated_at_ms", "updated_at_ms", "schema_version", "input_fingerprint", "ready", "headline", "summary", "evidence_record_count", "report_json", "viewed_at_ms"],
  context_notes: ["id", "source_id", "origin", "start_ms", "end_ms", "title", "category", "detail", "recorded_at_ms", "source_file", "source_row", "glucose_mmol_l"],
  insulin_daily_totals: ["id", "source_id", "timestamp_ms", "date_key", "basal_units", "bolus_units", "total_units", "imported_at_ms", "source_file", "source_row", "source_device_id"],
  food_recipes: ["id", "name", "meal_type", "servings", "carbohydrate_grams", "energy_kcal", "protein_grams", "fat_grams", "fibre_grams", "sugars_grams", "saturated_fat_grams", "created_at_ms", "updated_at_ms", "is_favorite"],
  food_recipe_items: ["id", "recipe_id", "ordinal", "catalog_id", "provider", "external_id", "name_snapshot", "brand_snapshot", "barcode_snapshot", "amount", "unit", "carbohydrate_grams", "energy_kcal", "protein_grams", "fat_grams", "fibre_grams", "sugars_grams", "saturated_fat_grams", "source_label", "source_url"],
  import_raw_records: ["id", "source_id", "record_kind", "timestamp_ms", "source_file", "source_row", "payload_json", "first_import_batch_id", "first_seen_at_ms", "last_import_batch_id", "last_seen_at_ms"],
  glooko_report_payloads: ["id", "source_id", "file_name", "file_sha256", "byte_length", "payload_base64", "extracted_text", "preview_json", "report_start_ms", "report_end_ms", "imported_at_ms"],
  portable_app_state: ["key", "value"],
});

export const RAW_EXCLUDED_TABLES = Object.freeze([
  "glooko_report_payloads",
  "import_source_payloads",
  "insight_reports",
  "notification_source_events",
  "portable_app_state",
]);

export const RAW_INCLUDED_TABLES = Object.freeze(
  Object.keys(RAW_BACKUP_TABLE_COLUMNS).filter(
    (name) => !RAW_EXCLUDED_TABLES.includes(name),
  ),
);
