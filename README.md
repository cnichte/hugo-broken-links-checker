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

Create a `hugo-broken-links-checker.config.json` in the root folder of your project:

```json
{
  "defaultJob": "carsten-local",
  "scanJobs": {
    "carsten-local": {
      "scan_source": "http://192.168.178.91:81/",
      "write_to_prefix": "data/links_checked/carsten-local-",
      "mode": "all",
      "date_format": "yyyy-MM-dd HH:mm:SSS",
      "special_excludes": [
        "data:image/webp",
        "blog:",
        "troubleshooting:",
        "mailto:"
      ],
      "checkOptions": {
        "path": "",
        "concurrency": 100,
        "recurse": true,
        "skip": "www.googleapis.com",
        "format": "json",
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
    }
  }
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
# doppeltes -- damit npm die Flags weiterreicht
```
