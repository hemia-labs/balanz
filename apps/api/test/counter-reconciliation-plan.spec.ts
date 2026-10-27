import { counterReconciliationIndexes } from './counter-reconciliation-plan';

describe('counter reconciliation index evidence', () => {
  const job = {
    'Node Type': 'Index Scan',
    'Index Name': 'ix_ingestion_jobs_counter_reconcile',
  };
  it.each([
    'ix_ingestion_items_job_updated',
    'ix_ingestion_items_job_result_ordinal',
  ])('accepts equivalent tenant/job-prefixed access through %s', (name) => {
    expect(
      counterReconciliationIndexes({
        Plans: [job, { 'Node Type': 'Index Only Scan', 'Index Name': name }],
      }),
    ).toEqual({
      jobIndex: job['Index Name'],
      itemIndexes: [name],
    });
  });
  it('rejects missing job index', () => {
    expect(() =>
      counterReconciliationIndexes({
        Plans: [
          {
            'Node Type': 'Index Scan',
            'Index Name': 'ix_ingestion_items_job_updated',
          },
        ],
      }),
    ).toThrow();
  });
  it('rejects a sequential scan or unrelated item index', () => {
    for (const item of [
      {
        'Node Type': 'Seq Scan',
        'Index Name': 'ix_ingestion_items_job_updated',
      },
      { 'Node Type': 'Index Scan', 'Index Name': 'unrelated' },
    ])
      expect(() =>
        counterReconciliationIndexes({ Plans: [job, item] }),
      ).toThrow();
  });
});
