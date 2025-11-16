# README

A tool for securely cleaning Hugo caches.

## Task

Check my Hugo Website for broken links.

Details follow

## Install

```bash
npm i -D hugo-broken-links-checker
# or
npm install --save-dev hugo-broken-links-checker
# or
yarn add --dev hugo-broken-links-checker
# or
pnpm add -D hugo-broken-links-checker
```

### Setup

Create a `hugo-broken-links.config.json` in the root folder of your project:

```json
{
  "jobs": [
    {
      "scan_source": "http://localhost:1313/",
      "write_to": "data/links_checked/external.json",
      "date_format": "yyyy-MM-dd HH:mm:ss",
      "mode": "extern",
      "special_excludes": [
        "data:image/webp",
        "mailto:",
        "blog:",
        "troubleshooting:"
      ],
      "checkOptions": {
        "concurrency": 100,
        "recurse": true,
        "skip": "www.googleapis.com",
        "silent": true,
        "verbosity": "error",
        "timeout": 0,
        "directoryListing": true,
        "retry": true,
        "retryErrors": true,
        "retryErrorsCount": 3,
        "retryErrorsJitter": 5,
        "userAgent": "Mozilla/4.0 (compatible; MSIE 6.0; MSIE 5.5; Windows NT 5.1)"
      }
    },
    {
      "scan_source": "http://localhost:1313/",
      "write_to": "data/links_checked/internal.json",
      "date_format": "yyyy-MM-dd HH:mm:ss",
      "mode": "intern",
      "special_excludes": [
        "data:image/webp",
        "mailto:",
        "blog:",
        "troubleshooting:"
      ]
    }
  ]
}
```

## Working with build skripts

Dann in der package.json:

```json
  "scripts": {
    "hugo:links": "node ./bin/hugo-broken-links.mjs",
    "hugo:links:dry": "node ./bin/hugo-broken-links.mjs --dry-run"
  }
```

## CLI

```bash
npm run hugo:links
# oder:
npm run hugo:links -- --config my-links.config.json
```
