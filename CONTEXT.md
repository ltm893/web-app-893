# CONTEXT.md — web-app-893
# Maintainer notes. Setup is in README.md.
# Last updated: 2026-10-11

## What this repo is
Generic, cloneable web frontend add-on for cognito-s3-stack-893.
Provides slideshow, dropbox, and calendar as a static web app.
Served via Amplify Hosting (static files only).
No pipeline-deploy. No CDK. No Amplify SDK.

## Repo family
Full map: [cognito-s3-stack-893](https://github.com/ltm893/cognito-s3-stack-893#repo-family). This repo is the website template. The live fork is `dliv-web`. Neighbors are in [README.md](README.md#repo-family).

## How to use this repo

### For forkers
1. Fork this repo and rename it to `your-domain-web` or similar
2. Deploy `cognito-s3-stack-893`, then `dropbox-893` and `calendar-893`. `pdf-search-893` and `video-convert-893` are optional.
3. Create a new Amplify Hosting app connected to your fork
4. Set environment variables in the Amplify console (see below). The region variable is `APP_REGION`. Leave `PDF_SEARCH_API_URL` and `VIDEO_CONVERT_API_URL` blank to hide those tools.
5. Deploy — `amplify.yml` generates `dliv_outputs.json` from env vars at build time
6. Your real AWS resource IDs never touch the repo

### For your personal deployment (dliv.com)
Fork this repo as `dliv-web`, set env vars in Amplify console, deploy.

## amplify.yml build step
Generates `dliv_outputs.json` from Amplify environment variables at build time.
No real values ever committed to the repo.

## Environment variables (set in Amplify console)
| Variable | Description | Example |
|----------|-------------|---------|
| `APP_REGION` | `aws_region` from `dropbox_outputs.json`. Written to `aws_region`. Sign-in calls `cognito-idp.${aws_region}`. | `us-east-1` |
| `USER_POOL_ID` | `auth.user_pool_id` from `dropbox_outputs.json` | `us-east-1_XXXXXXXXX` |
| `USER_POOL_CLIENT_ID` | `auth.user_pool_client_id` from `dropbox_outputs.json`. Not the client id in `base_outputs.json`. | `xxxxxxxxxxxxxxxxxx` |
| `DROPBOX_API_URL` | `api.base_url` from `dropbox_outputs.json` | `https://xxx.execute-api...` |
| `CALENDAR_API_URL` | calendar-893 API URL. Set this when the site uses the calendar. | `https://xxx.execute-api...` |
| `SLIDESHOW_API_URL` | Slideshow API URL. Blank uses `DROPBOX_API_URL`. | `https://xxx.execute-api...` |
| `PDF_SEARCH_API_URL` | Optional pdf-search-893 API URL. Blank hides PDF search. | `https://xxx.execute-api...` |
| `VIDEO_CONVERT_API_URL` | Optional video-convert-893 API URL. Blank hides the video tools. | `https://xxx.execute-api...` |
| `SITE_TITLE` | Site name for the sidebar and browser tab. | |
| `SITE_TAGLINE` | Line under the nav title. | |
| `SITE_FOOTER` | Line at the bottom of the nav. | |
| `SITE_PDF_SEARCH_LABEL` | Renames the PDF search nav item. Blank keeps PDF Search. | |
| `SITE_SHARED_LABEL` | Dropbox shared-tab label. Blank shows All users. | |
| `SITE_LINKS` | Optional JSON array of `{label, href}` nav links. Blank hides them. `href` must be `http:` or `https:`. | `[]` |

## Architecture
- NO pipeline-deploy — ever
- NO Amplify SDK — auth.js uses raw Cognito SRP (USER_PASSWORD_AUTH)
- Tokens stored in localStorage — they survive a browser restart
- Config read from dliv_outputs.json at runtime (fetch on page load)
- dliv_outputs.json generated at build time from env vars — never committed

## Files
| File | Description |
|------|-------------|
| `frontend/index.html` | Main page — slideshow + dropbox |
| `frontend/calendar.html` | Calendar page |
| `frontend/auth.js` | Raw Cognito SRP — no Amplify SDK |
| `frontend/albumSlideShow.js` | Slideshow |
| `frontend/privateFiles.js` | Dropbox file browser |
| `frontend/calendar.js` | Calendar CRUD |
| `frontend/slideshow.css` | Shared styles |
| `frontend/dliv_outputs.json` | gitignored — generated at build time |
| `frontend/dliv_outputs.example.json` | committed — schema for forkers |
| `amplify.yml` | Amplify Hosting build — generates config, no pipeline-deploy |

## dliv_outputs.json schema
```json
{
  "version": "1",
  "aws_region": "...",
  "auth": {
    "user_pool_id":        "...",
    "user_pool_client_id": "..."
  },
  "dropbox":   { "api_url": "..." },
  "calendar":  { "api_url": "..." },
  "slideshow": { "api_url": "..." },
  "pdfSearch": { "api_url": "..." },
  "videoConvert": { "api_url": "..." },
  "site": {
    "title": "",
    "tagline": "",
    "footer": "",
    "pdfSearchLabel": "",
    "sharedLabel": "",
    "links": [{ "label": "...", "href": "https://..." }]
  }
}
```

## Structure
```
web-app-893/
├── frontend/
│   ├── index.html
│   ├── calendar.html
│   ├── auth.js
│   ├── albumSlideShow.js
│   ├── privateFiles.js
│   ├── calendar.js
│   ├── slideshow.css
│   ├── dliv_outputs.json          ← gitignored — generated at build time
│   └── dliv_outputs.example.json  ← committed — schema
├── amplify.yml
├── CONTEXT.md
└── .gitignore
```

## Status
`amplify.yml` already writes `frontend/dliv_outputs.json` from the Amplify branch env vars. That file is gitignored. `dliv_outputs.example.json` is the committed schema.

Fork this repo for a new domain. `dliv-web` is the dliv.com deployment of this template, not the repo to fork.

PDF search and video convert stay off when `PDF_SEARCH_API_URL` and `VIDEO_CONVERT_API_URL` are blank.
