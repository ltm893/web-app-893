# CONTEXT.md — web-app-893
# Read this first at the start of every session.
# Last updated: 2026-05-05

## What this repo is
Generic, cloneable web frontend add-on for cognito-s3-stack-893.
Provides slideshow, dropbox, and calendar as a static web app.
Served via Amplify Hosting (static files only).
No pipeline-deploy. No CDK. No Amplify SDK.

## Repo family
| Repo | Status | Description |
|------|--------|-------------|
| `cognito-s3-stack-893` | ✅ | Base: Cognito + S3 — fork this first |
| `dropbox-893` | ✅ | Private file manager |
| `calendar-893` | ✅ | Calendar CRUD |
| `music-player-893` | ✅ | iOS music player |
| `web-app-893` | 🔜 Deploy | Web frontend — this repo |
| `mileage-expense-tracker-893` | ✅ | MET iOS app |

## How to use this repo

### For forkers
1. Fork this repo and rename it to `your-domain-web` or similar
2. Deploy `cognito-s3-stack-893`, `dropbox-893`, `calendar-893` first
3. Create a new Amplify Hosting app connected to your fork
4. Set environment variables in Amplify console (see below)
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
| `AWS_REGION` | AWS region | `us-east-1` |
| `USER_POOL_ID` | Cognito User Pool ID | `us-east-1_XXXXXXXXX` |
| `USER_POOL_CLIENT_ID` | Cognito App Client ID | `xxxxxxxxxxxxxxxxxx` |
| `DROPBOX_API_URL` | dropbox-893 API URL | `https://xxx.execute-api...` |
| `CALENDAR_API_URL` | calendar-893 API URL | `https://xxx.execute-api...` |
| `SLIDESHOW_API_URL` | slideshow API URL (usually same as dropbox) | `https://xxx.execute-api...` |

## Architecture
- NO pipeline-deploy — ever
- NO Amplify SDK — auth.js uses raw Cognito SRP (USER_PASSWORD_AUTH)
- Tokens stored in sessionStorage — cleared on tab close
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
  "slideshow": { "api_url": "..." }
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

## Next steps
1. Update amplify.yml to generate dliv_outputs.json from env vars ← do this next
2. Add dliv_outputs.json to .gitignore
3. Add dliv_outputs.example.json
4. Create GitHub repo web-app-893
5. Fork as dliv-web (your personal deployment)
6. Set env vars in Amplify console for dliv-web
7. Deploy and test slideshow, dropbox, calendar
8. Decommission old dliv.com Amplify app (d2d2tlr1n7ln0t)
