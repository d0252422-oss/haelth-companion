export const RELEASE_A_OMITTED_MIGRATIONS=Object.freeze([
  '20260913041844_manual_exercise_catalog_sql.sql',
  '20260913164026_manual_exercise_category_update.sql',
  '20260920222000_global_exercise_library_v1.sql',
  '20260920223000_manual_exercise_body_parts.sql',
  '20260920224000_manual_workout_set_order.sql',
]);

const releaseAOmissions=new Set(RELEASE_A_OMITTED_MIGRATIONS);
export function manualReleaseIncludesMigration(filename,release){
  if(!['A','AB'].includes(release))throw Error('INVALID_MANUAL_RELEASE');
  return release==='AB'||!releaseAOmissions.has(filename);
}
