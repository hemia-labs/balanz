interface PlanNode {
  'Node Type'?: string;
  'Index Name'?: string;
  Plans?: PlanNode[];
}

/** The SQL remains capped at 100 jobs and joins items on tenant + job.
 * PostgreSQL may choose either tenant/job-prefixed item index after Phase 2.
 * Keep checking actual index access, not the presence of a name anywhere in JSON.
 */
export function counterReconciliationIndexes(plan: PlanNode) {
  const indexes = new Set<string>();
  const visit = (node: PlanNode) => {
    if (node['Node Type']?.includes('Index') && node['Index Name'])
      indexes.add(node['Index Name']);
    node.Plans?.forEach(visit);
  };
  visit(plan);
  const jobIndex = 'ix_ingestion_jobs_counter_reconcile';
  const itemIndexes = [
    'ix_ingestion_items_job_updated',
    'ix_ingestion_items_job_result_ordinal',
  ].filter((name) => indexes.has(name));
  if (!indexes.has(jobIndex) || itemIndexes.length === 0)
    throw new Error(
      'Bounded counter reconciliation plan did not use the job index and a tenant/job-prefixed item index',
    );
  return { jobIndex, itemIndexes };
}
