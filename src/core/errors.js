// StudioError carries two messages: `friendly` is safe to show a child,
// `message` holds technical detail for logs and the parent/admin screens.
export class StudioError extends Error {
  constructor(code, message, { status = 400, friendly, details } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.friendly = friendly ?? FRIENDLY[code] ?? FRIENDLY.default;
    this.details = details;
  }
}

const FRIENDLY = {
  not_found: "We couldn't find that story.",
  invalid_input: 'Something about that didn’t look quite right. Please try again.',
  invalid_state: "That can't be done right now. Let's go back and try another step.",
  too_long: 'Wow, that is a really long story! It is too long to save in one piece.',
  rate_limited: 'Lots of magic happening! Please wait a little and try again.',
  ai_unavailable: 'The story helper is resting right now. Your writing is safe. Please try again later.',
  review_failed: "We couldn't check your story right now. Your writing is safe. Please try again.",
  images_failed: "We couldn't make pictures right now. Please try again.",
  publish_failed: 'Something went wrong while publishing your story. Your writing is safe. Please try again.',
  not_approved: 'This story needs Tashini to say it is ready before it can be published.',
  private_info:
    'Your story has something that looks like private information (like a phone number or address). Please take it out before publishing.',
  unauthorized: 'Please ask a grown-up to help with this.',
  forbidden: 'Please ask a grown-up to help with this.',
  default: 'Something went wrong. Your writing is safe. Please try again.',
};

export const notFound = (what = 'Story') =>
  new StudioError('not_found', `${what} not found`, { status: 404 });
