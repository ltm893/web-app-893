# web-app-893

Generic Amplify frontend for the **cognito-s3-stack-893** family. Static files only: slideshows, Dropbox, calendar, and optional OCR PDF search.

This repo is the **template**. Fork it as `your-domain-web` (the dliv.com fork is **`dliv-web`**). Backends stay in their own CDK repos — Amplify hosts the website and does **not** deploy stacks.

No Amplify SDK. `auth.js` uses raw Cognito SRP. Tokens live in `sessionStorage` and clear when the tab closes.

## Features

- **Slideshows** — public albums from `dropbox-893` (`GET /albums`)
- **Dropbox** — private files (Cognito JWT)
- **Calendar** — CRUD via `calendar-893`
- **PDF Search** — shown when `PDF_SEARCH_API_URL` is set (`pdf-search-893`). Search, plus multipart S3 intake of PDFs into the docs bucket.

## Repo family

Full map: [cognito-s3-stack-893](https://github.com/ltm893/cognito-s3-stack-893#repo-family).

This repo is the website template. The live fork is `dliv-web`. Sign-in uses the Cognito user pool from `cognito-s3-stack-893`. The template calls these backends through Amplify environment variables:

| Repo | Variable |
|------|----------|
| `dropbox-893` | `DROPBOX_API_URL` |
| `calendar-893` | `CALENDAR_API_URL` |
| `pdf-search-893` | `PDF_SEARCH_API_URL` (hidden when blank). OCR search and multipart S3 intake |

## Prerequisites

1. Deploy `cognito-s3-stack-893`, then `dropbox-893` and `calendar-893`.
2. Optionally deploy `pdf-search-893`.
3. Create an Amplify Hosting app pointed at this repo (or your fork).
4. Set environment variables on the Amplify branch (below).
5. Push. `amplify.yml` writes `frontend/dliv_outputs.json` at build time.

Real pool IDs and API URLs never go in git. The example file is the schema only.

## Amplify environment variables

Set these on the Amplify **branch** (not in the repo):

| Variable | Required | Description |
|----------|----------|-------------|
| `APP_REGION` | yes | AWS region (`us-east-1`) |
| `USER_POOL_ID` | yes | Cognito User Pool ID |
| `USER_POOL_CLIENT_ID` | yes | Cognito app client ID |
| `DROPBOX_API_URL` | yes | `dropbox-893` API URL (`https://…`) |
| `CALENDAR_API_URL` | if using calendar | `calendar-893` API URL |
| `SLIDESHOW_API_URL` | no | Defaults to `DROPBOX_API_URL` |
| `PDF_SEARCH_API_URL` | if using PDF search | `pdf-search-893` API URL (search and multipart S3 intake). The nav says **PDF Search** unless `SITE_PDF_SEARCH_LABEL` is set. |
| `VIDEO_CONVERT_API_URL` | no | `video-convert-893` API URL. Blank hides the video tools. |
| `SITE_PDF_SEARCH_LABEL` | no | Renames the PDF search nav item. Blank keeps **PDF Search**. |
| `SITE_TITLE` | no | Nav title. Blank keeps the title in the HTML. |
| `SITE_TAGLINE` | no | Line under the nav title. |
| `SITE_FOOTER` | no | Line at the bottom of the nav. |
| `SITE_LINKS` | no | JSON array of `{label, href}`. Blank hides the extra links. `href` must be `http:` or `https:`. |

The build fails if `DROPBOX_API_URL` is missing or not an `https://` URL, or if `SITE_LINKS` is set and is not that JSON array.

## Local

```bash
cd frontend
python3 -m http.server 8877
```

Copy `dliv_outputs.example.json` to `dliv_outputs.json` and fill in your outputs. That file is gitignored.

## Layout

| Path | Role |
|------|------|
| `frontend/index.html` | Slideshows, Dropbox, PDF Search |
| `frontend/calendar.html` | Calendar |
| `frontend/auth.js` | Cognito SRP |
| `frontend/dliv_outputs.example.json` | Config schema |
| `frontend/dliv_outputs.json` | Generated at build — gitignored |
| `amplify.yml` | Amplify Hosting build |
| `CONTEXT.md` | Maintainer notes |

## Security

- Do not commit `frontend/dliv_outputs.json`.
- Do not put real AWS IDs in source.
- Amplify is hosting only — never pipeline-deploy CDK from this repo.
