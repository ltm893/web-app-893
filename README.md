# web-app-893

Generic Amplify frontend for the **cognito-s3-stack-893** family. Static files only: slideshows, Dropbox, calendar, and optional PDF search and video convert.

This repo is the **template**. Fork it as `your-domain-web` (the dliv.com fork is **`dliv-web`**). Backends stay in their own CDK repos — Amplify hosts the website and does **not** deploy stacks.

`dliv-web` does not commit this frontend. Its Amplify build clones the branch in `TEMPLATE_REF` (`dev` by default, `main` on the dliv.com branch) and copies it into `frontend/`. A push here does not rebuild dev.dliv.com or dliv.com. Rebuild the Amplify branch whose `TEMPLATE_REF` is the branch you pushed. See `dliv-web` README, "Rebuilding after a web-app-893 change".

No Amplify SDK. `auth.js` uses raw Cognito SRP. Tokens live in `localStorage` and stay after the browser restarts. **Forgot password** asks Cognito to email a code, then sends that code with a new password. After the email is sent, the form shows only the reset fields. An unknown email gets the same response as a known one. The new password needs 8 or more characters, with upper, lower, a number, and a symbol.

## Features

- **Slideshows** — public albums from `dropbox-893` (`GET /albums`)
- **Dropbox** — private files (Cognito JWT). All DLIV Users has no Add. A video there can be renamed or moved to another folder under Videos. From Mine, **Move** places a file or folder somewhere else in that account, and **Share on DLIV** copies a Music, Photos, or Videos file or album into a folder with that person's name. Clip and Combine on an All DLIV Users video save the new MP4 in that folder when video convert is on.
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
| `video-convert-893` | `VIDEO_CONVERT_API_URL` (hidden when blank). Needs `dropbox-893`. Finished MP4s open from the Dropbox file list |

## Prerequisites

1. Deploy `cognito-s3-stack-893`, then `dropbox-893` and `calendar-893`.
2. Optionally deploy `pdf-search-893`. Deploy `video-convert-893` only after `dropbox-893`. Leave an API URL blank to hide that tool.
3. Create an Amplify Hosting app pointed at this repo (or your fork).
4. Set environment variables on the Amplify branch (below).
5. Push. `amplify.yml` writes `frontend/dliv_outputs.json` at build time.

Real pool IDs and API URLs never go in git. The example file is the schema only.

## Amplify environment variables

Set these on the Amplify **branch** (not in the repo):

| Variable | Required | Description |
|----------|----------|-------------|
| `APP_REGION` | yes | `aws_region` from `dropbox_outputs.json` |
| `USER_POOL_ID` | yes | `auth.user_pool_id` from `dropbox_outputs.json` |
| `USER_POOL_CLIENT_ID` | yes | `auth.user_pool_client_id` from `dropbox_outputs.json`. Not the client id in `base_outputs.json`. |
| `DROPBOX_API_URL` | yes | `api.base_url` from `dropbox_outputs.json` |
| `CALENDAR_API_URL` | if using calendar | `calendar-893` API URL |
| `SLIDESHOW_API_URL` | no | Defaults to `DROPBOX_API_URL` |
| `PDF_SEARCH_API_URL` | if using PDF search | `pdf-search-893` API URL (search and multipart S3 intake). The nav says **PDF Search** unless `SITE_PDF_SEARCH_LABEL` is set. |
| `VIDEO_CONVERT_API_URL` | no | `video-convert-893` API URL. Blank hides the video tools. |
| `SITE_PDF_SEARCH_LABEL` | no | Renames the PDF search nav item. Blank keeps **PDF Search**. |
| `SITE_TITLE` | no | Site name. Sets the sidebar and the browser tab. Blank leaves the sidebar text in the HTML. |
| `SITE_SHARED_LABEL` | no | Dropbox shared-tab label. Blank shows **All users**. |
| `SITE_TAGLINE` | no | Line under the nav title. |
| `SITE_FOOTER` | no | Line at the bottom of the nav. |
| `SITE_LINKS` | no | JSON array of `{label, href}`. Blank hides the extra links. `href` must be `http:` or `https:`. |

The website signs in with the Dropbox app client. After the `dropbox-893` deploy, copy `APP_REGION`, `USER_POOL_ID`, `USER_POOL_CLIENT_ID`, and `DROPBOX_API_URL` from `dropbox_outputs.json`. That file is gitignored. `base_outputs.json` has a different `user_pool_client_id` (`{id}-app-client`). The website uses `{id}-dropbox-client`, the client `deploy.sh` creates with `ALLOW_USER_PASSWORD_AUTH`.

`CALENDAR_API_URL` comes from `api.base_url` in `calendar_outputs.json`.

The build fails if `DROPBOX_API_URL` is missing or not an `https://` URL, or if `SITE_LINKS` is set and is not that JSON array.

## Local

```bash
npm test
cd frontend
python3 -m http.server 8877
```

`npm test` is `node --test tests/`. `git push` runs it first, using Node 20. A new clone needs `bash scripts/install-git-hooks.sh` once. `SKIP_TESTS=1 git push` skips the check. GitHub runs the same tests on a pull request and does not require them to pass.

Copy `dliv_outputs.example.json` to `dliv_outputs.json` and fill in your outputs. That file is gitignored.

## Layout

| Path | Role |
|------|------|
| `frontend/index.html` | Slideshows, Dropbox, PDF Search |
| `frontend/calendar.html` | Calendar |
| `frontend/auth.js` | Cognito SRP, including forgot-password and confirm |
| `frontend/passwordReset.js` | Reset form on the sign-in blocks |
| `frontend/dliv_outputs.example.json` | Config schema |
| `frontend/dliv_outputs.json` | Generated at build — gitignored |
| `amplify.yml` | Amplify Hosting build |
| `CONTEXT.md` | Maintainer notes |

## Security

- Do not commit `frontend/dliv_outputs.json`.
- Do not put real AWS IDs in source.
- Amplify is hosting only — never pipeline-deploy CDK from this repo.
