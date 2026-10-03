import { StudioError } from './errors.js';

export const S = Object.freeze({
  DRAFT: 'DRAFT',
  REVIEWING: 'REVIEWING',
  READY_TO_PUBLISH: 'READY_TO_PUBLISH',
  PUBLISHING: 'PUBLISHING',
  PUBLISHED: 'PUBLISHED',
  REVIEW_FAILED: 'REVIEW_FAILED',
  IMAGE_GENERATION_FAILED: 'IMAGE_GENERATION_FAILED',
  PUBLISH_FAILED: 'PUBLISH_FAILED',
});

// Every failure state can be retried (moved back into the step that failed).
const TRANSITIONS = {
  DRAFT: ['REVIEWING'],
  REVIEWING: ['DRAFT', 'REVIEWING', 'REVIEW_FAILED', 'IMAGE_GENERATION_FAILED', 'READY_TO_PUBLISH'],
  REVIEW_FAILED: ['REVIEWING', 'DRAFT', 'READY_TO_PUBLISH'],
  IMAGE_GENERATION_FAILED: ['REVIEWING', 'DRAFT', 'READY_TO_PUBLISH'],
  READY_TO_PUBLISH: ['REVIEWING', 'DRAFT', 'PUBLISHING'],
  PUBLISHING: ['PUBLISHED', 'PUBLISH_FAILED'],
  PUBLISH_FAILED: ['PUBLISHING', 'READY_TO_PUBLISH', 'REVIEWING', 'DRAFT'],
  PUBLISHED: ['REVIEWING', 'DRAFT'],
};

export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new StudioError('invalid_state', `Cannot move story from ${from} to ${to}`, { status: 409 });
  }
}

// Child-facing labels; never show the raw enum to Tashini.
export const STATUS_LABEL = {
  DRAFT: 'Draft',
  REVIEWING: 'Reviewing',
  READY_TO_PUBLISH: 'Ready to Publish',
  PUBLISHING: 'Publishing…',
  PUBLISHED: 'Published',
  REVIEW_FAILED: 'Needs another check',
  IMAGE_GENERATION_FAILED: 'Pictures need another try',
  PUBLISH_FAILED: 'Publishing Failed',
};
