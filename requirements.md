# Story Studio for Tashini

## 1. Overview

Story Studio is a simple web application for a child who enjoys writing and reading stories.

The primary user is Tashini. She should be able to open the application, create a new story, write naturally, have her work automatically saved as a draft, finish the story, receive helpful grammar and writing feedback, generate a small set of cartoon-style illustrations for important scenes, preview the complete story, and finally publish it.

Published stories are committed automatically to a GitHub repository named `stories` and exposed through GitHub Pages. Other readers can browse published stories and open an individual story to read it.

The system should feel like a friendly personal story-writing studio, not a technical publishing tool.

The most important principle is:

> Tashini should focus on writing. The application should handle the technical work.

---

## 2. Goals

### Primary goals

1. Provide a very simple writing interface for a child.
2. Automatically save unfinished stories as drafts.
3. Never lose significant writing because of a browser refresh or accidental navigation.
4. Allow Tashini to finish a story and enter a review stage.
5. Use AI to:
   - Correct obvious grammar, spelling, punctuation, and sentence issues.
   - Give age-appropriate writing suggestions.
   - Identify strengths in the story.
   - Suggest ways to make the story more interesting.
6. Generate a few cartoon-style illustrations based on scenes from the story.
7. Allow Tashini to review the corrected story, feedback, and illustrations before publishing.
8. Publish the approved story automatically to GitHub.
9. Generate static HTML pages suitable for GitHub Pages.
10. Provide a simple public story library.
11. Allow readers to open and read individual stories.
12. Help Tashini improve her writing over time through constructive feedback.

### Secondary goals

- Keep the architecture simple enough for a home project.
- Prefer static content after publication.
- Avoid requiring a database initially.
- Keep GitHub as the source of truth for published content.
- Make the application easy to extend later.
- Keep the child-facing interface visually friendly and uncluttered.

---

## 3. Non-Goals for Version 1

The first version should NOT attempt to become a full social writing platform.

Do not initially implement:

- Public user registration.
- Multiple child accounts.
- Public comments.
- Likes/followers.
- Chat between readers.
- Complex rich-text editing.
- Online collaborative editing.
- Story monetisation.
- Advertising.
- Full publishing analytics.
- Complex content moderation workflows.
- Automatic publishing without Tashini's approval.
- A complicated CMS.

These can be considered later.

---

## 4. High-Level User Journey

The intended workflow is:

```text
Open Story Studio
      |
      v
Create New Story
      |
      v
Write Story
      |
      | Auto-save
      v
Draft
      |
      v
Finish Story
      |
      v
AI Review
      |
      +---- Grammar corrections
      |
      +---- Writing feedback
      |
      +---- Story strengths
      |
      +---- Improvement suggestions
      |
      +---- Scene detection
      |
      v
Generate Cartoon Illustrations
      |
      v
Story Preview
      |
      v
Tashini Reviews
      |
      +---- Edit / regenerate / revise
      |
      v
Publish
      |
      v
GitHub Repository
      |
      v
GitHub Pages
      |
      v
Public Story Library
```

---

# 5. User Roles

## 5.1 Author

The author is Tashini.

She can:

- Create stories.
- Edit drafts.
- Continue unfinished stories.
- Finish a story.
- Review AI feedback.
- Accept or reject grammar suggestions.
- Edit the story after feedback.
- Generate illustrations.
- Select preferred illustrations.
- Preview the final story.
- Publish the story.

## 5.2 Parent/Admin

The parent has additional control.

The parent can:

- View drafts.
- View all stories.
- Review stories before publication if desired.
- Delete drafts.
- Unpublish or hide a story from the index.
- Regenerate images.
- Regenerate AI feedback.
- Configure AI settings.
- Configure GitHub publishing.
- Configure the custom domain later.
- View publishing logs/errors.

Version 1 can keep parent access extremely simple, for example through a protected admin route or a local/admin-only configuration.

---

# 6. Core Features

## 6.1 Home Screen

The home screen should be very simple.

Suggested layout:

```text
--------------------------------------
       Tashini's Story Studio

        [ + New Story ]

        My Stories

   Drafts
   --------------------------------
   The Magic Pencil
   The Lost Puppy

   Published
   --------------------------------
   The Adventure in the Forest
   The Little Dragon
--------------------------------------
```

Each story card should show:

- Title
- Status
- Last edited date
- Optional cover image
- Word count
- Continue/View button

Statuses:

- Draft
- Reviewing
- Ready to Publish
- Published
- Publishing Failed

---

# 7. Create New Story

Clicking `New Story` opens a very simple editor.

Initial fields:

- Story title
- Story body

Optional:

- Short description
- Author name
- Genre
- Age/category
- Mood

For the child-facing experience, optional fields should not interrupt writing.

The application may initially use:

```text
Title: [_____________________]

[ Start writing your story here... ]

Word count: 0

                         [Save Draft]
```

The title can also be inferred later if Tashini leaves it blank.

---

# 8. Story Editor

The editor is one of the most important parts of the application.

It should be distraction-free.

Recommended features:

- Large readable writing area.
- Large font.
- Comfortable line spacing.
- Minimal buttons.
- Word count.
- Character count optionally.
- Save status.
- Undo/redo.
- Basic formatting only if necessary.

Avoid exposing technical concepts.

Instead of:

```text
Git commit
API
Repository
Build
Deployment
```

the UI should use:

```text
Saved
Checking your story...
Creating pictures...
Ready to publish
Published
```

---

# 9. Automatic Draft Saving

Drafts must be automatically saved.

The application should save after:

- A short debounce period after typing, e.g. 1-3 seconds.
- Manual Save.
- Leaving the editor.
- Browser/tab visibility changes where possible.

The UI should clearly show:

```text
✓ Saved
```

or:

```text
Saving...
```

If saving fails:

```text
Couldn't save right now.
Your latest writing is still stored on this device.
```

For Version 1, drafts can be stored locally using:

- IndexedDB, preferred.
- localStorage as a fallback.

A later version may use a backend database.

The system should preserve:

- Story ID
- Title
- Content
- Created timestamp
- Updated timestamp
- Status
- Revision number

---

# 10. Draft Model

Example:

```json
{
  "id": "story-2026-001",
  "title": "The Magic Pencil",
  "content": "Once upon a time...",
  "status": "draft",
  "createdAt": "2026-10-03T10:00:00Z",
  "updatedAt": "2026-10-03T10:12:00Z",
  "revision": 4
}
```

Draft data should be separate from published content.

A draft must never automatically become publicly visible.

---

# 11. Finish Story

The editor should have a clear button:

```text
I'm Finished
```

or:

```text
Finish Story
```

Clicking it should not publish the story.

Instead, it moves the story into the review workflow.

Confirmation:

```text
Are you finished with your story?

We'll check your writing and prepare some pictures.
You can still make changes before publishing.

[Continue] [Go Back]
```

---

# 12. AI Review

After finishing, the application sends the story to the AI review service.

The AI should produce structured results rather than only returning rewritten text.

The response should contain:

1. Corrected version.
2. Original version.
3. Grammar issues.
4. Spelling issues.
5. Punctuation issues.
6. Sentence improvement suggestions.
7. Vocabulary suggestions.
8. Story structure feedback.
9. Strengths.
10. Suggestions for improvement.
11. Scene candidates for illustrations.
12. Suggested story title if appropriate.

---

# 13. Child-Friendly Feedback

Feedback must be appropriate for a primary-school child.

Avoid harsh language such as:

> "This sentence is poorly written."

Prefer:

> "This sentence could be clearer if you say..."

or:

> "Great idea! You could make this part more exciting by describing what the character saw."

The system should encourage the child.

Feedback should not simply rewrite everything and hide the learning opportunity.

The goal is:

> Help Tashini become a better writer, not replace her writing.

---

# 14. Grammar Review UX

The application should show the original and suggested version.

Example:

```text
Your sentence:

The dog run very fast to the park.

Suggestion:

The dog ran very fast to the park.

Why?

"Ran" is the past tense of "run" because your story is written in the past tense.

[Use Suggestion] [Keep My Sentence]
```

The author should remain in control.

AI corrections should never silently overwrite the original story.

---

# 15. Writing Feedback

The review page should contain sections such as:

### What You Did Well

Example:

- Your story has a clear beginning, middle and ending.
- The description of the forest makes the scene easy to imagine.
- The ending has a nice surprise.

### Things You Could Improve

Example:

- Add more details about how the character felt.
- Try using dialogue in one scene.
- Describe the setting before the action begins.

### One Writing Tip

Give one or two useful age-appropriate writing tips rather than overwhelming the child.

---

# 16. Scene Detection

The AI should identify important visual scenes.

For example:

```text
Scene 1
Maya discovers a glowing door in the forest.

Scene 2
Maya opens the door and meets a tiny dragon.

Scene 3
Maya and the dragon fly above the village.
```

The system should normally generate 2-5 images per story depending on story length.

Avoid generating an image for every paragraph.

Images should support the story rather than interrupt it.

---

# 17. Image Generation

All story illustrations should have a consistent cartoon/children's-book style.

Default style:

- Friendly cartoon illustration.
- Children's storybook appearance.
- Bright and engaging.
- Safe for children.
- No photorealistic people.
- No scary or disturbing imagery unless explicitly appropriate.
- Consistent characters across scenes where possible.

The application should generate images based on the story and scene descriptions.

Example internal image prompt:

```text
Create a cheerful children's storybook cartoon illustration.

Scene:
A young girl discovers a glowing blue door hidden behind an old tree in an enchanted forest.

Style:
Soft children's book cartoon illustration, expressive characters,
friendly atmosphere, colourful environment, clean shapes,
warm lighting.

Do not include text, captions, speech bubbles, logos or watermarks.
```

The actual prompt should be generated dynamically from the story.

---

# 18. Image Consistency

A major requirement is character consistency.

If the story contains:

```text
Maya
- 9-year-old girl
- black hair
- yellow backpack
- blue dress
```

the same visual description should be reused for subsequent scenes.

The system should maintain a simple:

```json
{
  "characters": [
    {
      "name": "Maya",
      "description": "9-year-old girl with black hair, blue dress and yellow backpack"
    }
  ]
}
```

This should be included when generating subsequent images.

Version 1 does not need advanced character LoRA/model training.

---

# 19. Image Selection

If multiple images are generated for a scene, show them as choices.

Example:

```text
Scene 1

[ Image A ] [ Image B ] [ Image C ]

Choose the picture you like best.

[Generate Again]
```

Tashini should be able to select one.

Selected images become part of the published story.

---

# 20. Story Preview

Before publishing, provide a full preview.

The preview should look close to the actual GitHub Pages version.

Example:

```text
-----------------------------------------
             The Magic Pencil

          [Cover Illustration]

Once upon a time...

[Illustration]

Maya walked into the forest...

[Illustration]

At last, she discovered...
-----------------------------------------

Written by Tashini
```

Buttons:

```text
[Edit Story]
[Review Feedback]
[Regenerate Pictures]
[Publish Story]
```

---

# 21. Publish Flow

Publishing should be an explicit action.

Button:

```text
Publish Story
```

Confirmation:

```text
Your story is ready!

It will be added to your story collection so other people can read it.

[Publish] [Go Back]
```

After confirmation:

```text
Preparing story...
Creating web page...
Saving pictures...
Publishing...
Almost ready...
```

Then:

```text
Your story is published!

[Read Story]
[View All Stories]
```

---

# 22. GitHub Repository Structure

Recommended repository structure:

```text
stories/
│
├── index.html
├── stories/
│   ├── magic-pencil/
│   │   ├── index.html
│   │   ├── story.json
│   │   └── images/
│   │       ├── scene-01.webp
│   │       ├── scene-02.webp
│   │       └── scene-03.webp
│   │
│   ├── lost-puppy/
│   │   ├── index.html
│   │   ├── story.json
│   │   └── images/
│   │       ├── scene-01.webp
│   │       └── scene-02.webp
│
└── assets/
    ├── css/
    └── js/
```

The repository should contain only published stories and public website assets.

Drafts must not be committed to the public repository.

---

# 23. Story JSON

Each published story should have structured metadata.

Example:

```json
{
  "id": "magic-pencil",
  "title": "The Magic Pencil",
  "author": "Tashini",
  "description": "A girl discovers a pencil that can bring her drawings to life.",
  "publishedAt": "2026-10-03",
  "readingTimeMinutes": 4,
  "wordCount": 650,
  "coverImage": "images/scene-01.webp",
  "scenes": [
    {
      "id": "scene-01",
      "image": "images/scene-01.webp",
      "text": "Maya walked deep into the forest..."
    }
  ]
}
```

---

# 24. Public Story Library

The GitHub Pages site should have a home page showing all published stories.

Example:

```text
Tashini's Story World

Welcome to my collection of stories!

--------------------------------

[Picture]
The Magic Pencil
A magical adventure...
Read Story →

--------------------------------

[Picture]
The Lost Puppy
A story about kindness...
Read Story →
```

Sort order:

- Newest first by default.
- Optional oldest first.

Future options:

- Genre filters.
- Search.
- Favourite stories.
- Reading level.

---

# 25. Individual Story Page

Each story should have a clean reading experience.

Requirements:

- Large readable text.
- Comfortable spacing.
- Responsive design.
- Illustrations between relevant sections.
- Story title.
- Author.
- Optional publication date.
- Back to stories button.
- Optional estimated reading time.

Example:

```text
← Back to Stories

The Magic Pencil

By Tashini

[Illustration]

Once upon a time...

[Illustration]

Maya walked deeper into the forest...

[Illustration]

The End

⭐ More Stories
```

---

# 26. GitHub Publishing Architecture

The recommended architecture is:

```text
                Story Studio
                     |
                     v
              Review / Publish
                     |
                     v
             Publishing Service
                     |
                     v
              GitHub Repository
                     |
                  GitHub Actions
                     |
                     v
               GitHub Pages
```

The browser should NOT contain a long-lived GitHub Personal Access Token.

Preferred approach:

- Frontend calls a small backend/serverless API.
- Backend authenticates to GitHub using a secure secret.
- Backend creates/updates files in the repository.
- GitHub Actions can optionally build/validate the site.
- GitHub Pages serves the generated static site.

Possible backend options:

- AWS Lambda + API Gateway.
- Cloudflare Workers.
- Vercel/Netlify serverless function.
- Small Node.js service.
- GitHub Actions triggered through a controlled mechanism.

For a home project, AWS Lambda or Cloudflare Workers would be sufficient.

---

# 27. GitHub Commit Strategy

A published story should result in a Git commit.

Example commit:

```text
Add story: The Magic Pencil
```

The commit should contain:

```text
stories/magic-pencil/index.html
stories/magic-pencil/story.json
stories/magic-pencil/images/scene-01.webp
stories/magic-pencil/images/scene-02.webp
stories/magic-pencil/images/scene-03.webp
```

The story index should also be updated.

Example:

```text
Update story index: The Magic Pencil
```

It is preferable to use one atomic commit for the story and related assets.

---

# 28. GitHub Actions

GitHub Actions should validate and publish the website.

Possible workflow:

```text
Push to main
    |
    v
Validate JSON
    |
    v
Validate HTML
    |
    v
Optimise/check assets
    |
    v
Build static site if required
    |
    v
Deploy GitHub Pages
```

The system should fail clearly if validation fails.

---

# 29. Content Safety

Because the author is a child, safety is an important requirement.

The system should have safeguards around generated content and images.

AI should avoid generating:

- Graphic violence.
- Sexual content.
- Adult themes.
- Dangerous instructions.
- Hate content.
- Bullying content targeting real people.
- Personal information.
- Identifiable information about children.

The image generation prompt should explicitly request child-safe illustrations.

The system should also avoid exposing private information in published stories.

---

# 30. Privacy

The public site should expose only intentionally published information.

Do not publish:

- Home address.
- School address.
- Phone number.
- Email address.
- Private family information.
- Drafts.
- AI review history unless explicitly desired.
- Internal application metadata.

The public author name could simply be:

```text
Tashini
```

rather than a full legal name.

---

# 31. AI Prompt Design

AI prompts should be version-controlled.

Example:

```text
You are a friendly writing coach helping a primary-school child improve
her creative writing.

Do not rewrite the story in a way that removes the child's voice.

Identify:
- spelling mistakes
- grammar mistakes
- punctuation mistakes
- unclear sentences
- opportunities to improve descriptions
- opportunities to improve dialogue
- story structure
- strengths

Use encouraging, age-appropriate language.

Return structured JSON.
```

The prompt version should be stored with the review result.

Example:

```json
{
  "reviewVersion": "1.0",
  "model": "...",
  "generatedAt": "...",
  "feedback": {}
}
```

---

# 32. AI Output Schema

Suggested structure:

```json
{
  "correctedStory": "...",
  "summary": "...",
  "strengths": [
    "...",
    "..."
  ],
  "improvements": [
    "...",
    "..."
  ],
  "grammarSuggestions": [
    {
      "original": "The boy run home.",
      "suggestion": "The boy ran home.",
      "explanation": "Use 'ran' because the story is in the past tense."
    }
  ],
  "characters": [
    {
      "name": "Maya",
      "description": "..."
    }
  ],
  "scenes": [
    {
      "sceneNumber": 1,
      "description": "...",
      "imagePrompt": "..."
    }
  ]
}
```

The application must validate AI responses before using them.

If the AI response is invalid, the application should not publish it.

---

# 33. Preserve the Child's Voice

This is a core product requirement.

The system must distinguish between:

### Correction

Fixing:

```text
She go to the shop yesterday.
```

to:

```text
She went to the shop yesterday.
```

### Rewriting

Changing:

```text
The monster was very scary.
```

to:

```text
A terrifying creature emerged from the shadowy depths...
```

The second may sound more sophisticated but could stop sounding like a child's own writing.

The application should therefore provide:

```text
Grammar Corrections
```

separately from:

```text
Optional Writing Ideas
```

The original writing should always remain accessible.

---

# 34. Revision History

The application should keep revisions.

Example:

```text
Revision 1
Original draft

Revision 2
After grammar corrections

Revision 3
Final version
```

A future enhancement can provide side-by-side comparison.

At minimum, the system should be able to restore the previous version.

---

# 35. Story States

Recommended state machine:

```text
DRAFT
  |
  v
REVIEWING
  |
  v
READY_TO_PUBLISH
  |
  v
PUBLISHING
  |
  v
PUBLISHED
```

Failure states:

```text
REVIEW_FAILED
PUBLISH_FAILED
IMAGE_GENERATION_FAILED
```

Failed operations should be retryable.

---

# 36. Error Handling

Errors should be understandable to a child.

Do not show:

```text
HTTP 401 Unauthorized
```

Instead show:

```text
Something went wrong while saving your story.
Your writing is safe. Please try again.
```

Technical details should go to logs.

Parent/admin screens may show technical details.

---

# 37. Offline / Poor Network Behaviour

The editor should work reasonably well when temporarily offline.

Recommended behaviour:

1. Save draft locally.
2. Display:

```text
Saved on this device
```

3. When connection returns, synchronize automatically.

The child should not lose a story because Wi-Fi temporarily disappears.

---

# 38. Responsive Design

The application should work on:

- Desktop.
- Laptop.
- Tablet.
- Mobile.

The primary writing experience can be optimised for desktop/tablet.

Published stories should be especially mobile-friendly.

---

# 39. Visual Design

The child-facing UI should feel like a small digital storybook.

Suggested characteristics:

- Soft rounded cards.
- Large readable typography.
- Friendly icons.
- Plenty of whitespace.
- Light background.
- Simple navigation.
- Cartoon illustrations.
- Subtle animations.
- No clutter.

Avoid making it look like an enterprise CMS.

The writing editor should remain calm and distraction-free.

---

# 40. Accessibility

Requirements:

- Good colour contrast.
- Keyboard navigation.
- Large click targets.
- Readable font sizes.
- Alt text for images.
- Semantic HTML.
- Screen-reader-friendly controls.
- Avoid colour-only status indicators.

---

# 41. Suggested Technical Architecture

A simple initial implementation could use:

### Frontend

```text
HTML
CSS
JavaScript
```

or optionally:

```text
React / Vite
```

Do not introduce a framework unless it provides a clear benefit.

For a small personal project, vanilla HTML/CSS/JS is completely acceptable.

### Draft Storage

Version 1:

```text
IndexedDB
```

### Backend

```text
Serverless API
```

Responsibilities:

- AI review.
- Image generation.
- GitHub publishing.

### AI

Use an LLM API for:

- Story review.
- Grammar analysis.
- Scene extraction.
- Image prompt creation.

Use an image generation API for:

- Cartoon illustrations.

### Publishing

```text
GitHub API
GitHub Actions
GitHub Pages
```

---

# 42. Recommended API Endpoints

Example:

```text
POST /api/review-story
```

Input:

```json
{
  "storyId": "...",
  "title": "...",
  "content": "..."
}
```

Output:

```json
{
  "review": {}
}
```

---

```text
POST /api/generate-images
```

Input:

```json
{
  "storyId": "...",
  "scenes": []
}
```

Output:

```json
{
  "images": []
}
```

---

```text
POST /api/publish
```

Input:

```json
{
  "storyId": "...",
  "title": "...",
  "content": "...",
  "selectedImages": []
}
```

Output:

```json
{
  "status": "published",
  "url": "..."
}
```

---

# 43. Security Requirements

The GitHub token must never be included in frontend JavaScript.

Never commit:

```text
GITHUB_TOKEN
OPENAI_API_KEY
IMAGE_API_KEY
```

to the repository.

Use environment secrets.

The backend should validate:

- Story size.
- Allowed content.
- File names.
- Image types.
- Request frequency.
- Authentication/authorisation.

Prevent arbitrary GitHub file writes.

The publishing API should only be able to write to the intended repository and directories.

---

# 44. Abuse Protection

Even though this is a private family application, basic protection should exist.

Implement:

- Request rate limits.
- Maximum story size.
- Maximum image generation count.
- Maximum image size.
- Allowed file extensions.
- Input sanitisation.
- HTML escaping.
- Content validation.

Published story content must never be inserted into HTML using unsafe raw HTML.

---

# 45. SEO and Social Sharing

Published pages should contain:

```html
<title>The Magic Pencil | Tashini's Story World</title>

<meta name="description"
      content="A magical adventure written by Tashini.">

<meta property="og:title"
      content="The Magic Pencil">

<meta property="og:description"
      content="A magical adventure written by Tashini.">

<meta property="og:image"
      content="...">
```

This will make shared stories look better.

---

# 46. Custom Domain

GitHub Pages should initially be used with its default URL.

Later:

```text
stories.example.com
```

or:

```text
tashini.example.com
```

can be configured.

The generated website should therefore avoid hardcoding the GitHub Pages hostname.

Use relative URLs wherever possible.

---

# 47. Future Custom Domain Architecture

Later:

```text
Custom Domain
      |
      v
DNS
      |
      v
GitHub Pages
```

The application itself does not need to change.

Only deployment configuration and DNS should change.

---

# 48. Testing Requirements

The application should include tests for:

### Editor

- Create story.
- Edit story.
- Autosave.
- Restore draft.
- Refresh page without losing content.

### Review

- AI request succeeds.
- AI request fails.
- Invalid AI response is rejected.
- Grammar suggestions render correctly.

### Images

- Scene extraction.
- Image generation.
- Failed image generation.
- Retry.
- Image selection.

### Publishing

- Story generated correctly.
- JSON generated correctly.
- HTML generated correctly.
- Images copied correctly.
- GitHub commit succeeds.
- GitHub failure handled correctly.
- Published URL returned.

### Security

- HTML escaping.
- Script injection prevention.
- Token never exposed to browser.
- Invalid story IDs rejected.

---

# 49. Acceptance Criteria

Version 1 is successful when the following workflow works end-to-end:

### Scenario 1: Create Draft

1. Tashini opens Story Studio.
2. Clicks `New Story`.
3. Enters a title.
4. Writes several paragraphs.
5. Stops typing.
6. Application automatically saves.
7. She refreshes the page.
8. Story is still available.
9. She can continue writing.

### Scenario 2: Review

1. Tashini clicks `Finish Story`.
2. Application sends story for review.
3. Grammar corrections are displayed.
4. Strengths are displayed.
5. Improvement suggestions are displayed.
6. Story remains editable.

### Scenario 3: Illustrations

1. Application identifies several important scenes.
2. Cartoon illustrations are generated.
3. Tashini sees the illustrations.
4. She can select a preferred image.
5. She can regenerate an image if she does not like it.

### Scenario 4: Preview

1. Tashini opens Preview.
2. The story is shown in reading format.
3. Illustrations appear at appropriate locations.
4. The preview resembles the final public page.

### Scenario 5: Publish

1. Tashini clicks Publish.
2. Application confirms publication.
3. Backend commits the story to GitHub.
4. GitHub Pages deploys the updated site.
5. The story appears in the story library.
6. Clicking the story opens its individual page.

### Scenario 6: Reader

1. Another person opens the story website.
2. They see the published story collection.
3. They select a story.
4. The story opens quickly.
5. Text and images display correctly.
6. They can return to the story collection.

---

# 50. Suggested Project Structure

For the application itself:

```text
story-studio/
│
├── frontend/
│   ├── index.html
│   ├── editor.html
│   ├── review.html
│   ├── preview.html
│   ├── css/
│   ├── js/
│   └── assets/
│
├── backend/
│   ├── review/
│   ├── images/
│   ├── publish/
│   └── shared/
│
├── prompts/
│   ├── story-review.txt
│   ├── scene-generation.txt
│   └── image-generation.txt
│
├── tests/
│
├── README.md
└── requirements.md
```

This structure can change if a framework is selected.

---

# 51. Recommended Development Phases

## Phase 1: Writing MVP

Build:

- Home page.
- New story.
- Story editor.
- Autosave.
- Draft list.
- Resume draft.

Do not build AI or GitHub publishing yet.

Success condition:

> Tashini can write stories safely without losing them.

---

## Phase 2: AI Review

Add:

- Finish Story.
- Grammar review.
- Writing feedback.
- Suggestions.
- Revision handling.

Success condition:

> Tashini can learn from useful feedback without losing her original writing.

---

## Phase 3: Illustrations

Add:

- Scene detection.
- Character descriptions.
- Image prompts.
- Cartoon image generation.
- Image selection.
- Regeneration.

Success condition:

> Every story can receive a small set of attractive, relevant illustrations.

---

## Phase 4: Preview

Add:

- Storybook-style preview.
- Images embedded at scene locations.
- Mobile layout.
- Final review.

Success condition:

> Tashini can see exactly what readers will experience.

---

## Phase 5: GitHub Publishing

Add:

- GitHub backend integration.
- Repository file generation.
- Git commit.
- GitHub Actions.
- GitHub Pages.
- Story index generation.

Success condition:

> Clicking Publish results in a publicly readable story.

---

## Phase 6: Polish

Add:

- Better animations.
- Reading time.
- Story search.
- Genres.
- Better character consistency.
- Parent dashboard.
- Revision history.
- Custom domain.

---

# 52. Important Product Principle

The application should not feel like an AI writing machine.

The desired experience is:

```text
Tashini writes
      ↓
AI helps
      ↓
Tashini learns
      ↓
Tashini chooses
      ↓
Tashini publishes
```

Not:

```text
Tashini gives an idea
      ↓
AI writes the entire story
      ↓
Publish
```

The child's creativity and authorship should remain central.

---

# 53. Future Ideas

Potential future enhancements:

- Story series.
- Characters library.
- Reusable characters.
- Illustrated book mode.
- Read-aloud mode.
- Text-to-speech narration.
- Background music toggle.
- Story categories.
- Reading progress.
- "Story of the Month".
- Parent feedback.
- Private family-only stories.
- Draft sharing with parents.
- Printable PDF books.
- EPUB export.
- Book cover generation.
- Automatic table of contents for story collections.
- Multilingual stories.
- Chinese/English bilingual stories.
- Writing skill tracking.
- Personal writing improvement dashboard.
- AI writing coach that remembers common grammar mistakes.
- Vocabulary builder based on Tashini's own stories.

---

# 54. Definition of Done

Version 1 is considered complete when:

- Tashini can create a story.
- Stories are automatically saved as drafts.
- Drafts survive browser refresh.
- Tashini can finish a story.
- AI can review the story.
- Grammar suggestions are presented clearly.
- Writing feedback is age appropriate.
- Original writing remains available.
- AI identifies suitable illustration scenes.
- Cartoon images can be generated.
- Tashini can select images.
- Full story preview works.
- Publishing requires explicit confirmation.
- Published content is committed to GitHub.
- GitHub Pages serves the story.
- The public story index updates.
- Individual stories are readable on desktop and mobile.
- API secrets are never exposed to the browser.
- Failed AI/image/GitHub operations can be retried.
- Private drafts are never accidentally published.

---

# 55. Final Experience

The ideal experience should be as simple as:

```text
                    Tashini
                       |
                       v
               "Write a Story"
                       |
                       v
                She starts writing
                       |
                       v
                 ✓ Saved
                       |
                       v
                "I'm Finished"
                       |
                       v
             Friendly AI feedback
                       |
                       v
                Cartoon pictures
                       |
                       v
                  Preview
                       |
                       v
                   Publish
                       |
                       v
              "Your story is live!"
                       |
                       v
             Friends & family read it
```

The technology should stay in the background.

For Tashini, it should simply feel like having her own little online storybook studio.

