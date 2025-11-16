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
        "timeout": 15000,
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

> ℹ️  `timeout` begrenzt standardmäßig jede HTTP-Anfrage auf 15 s. Passe den Wert bei Bedarf unter `checkOptions.timeout` an, falls deine Infrastruktur langsam antwortet. Für Details, welche URL zuletzt geprüft wurde, kannst du `DEBUG=linkinator npm run hugo:links` setzen.

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

## Result

Schreibt das ergebnis des Scans in json DAteien

```json
{
  "scan_source": "http://192.168.178.91:81/",
  "mode": "all",
  "special_excludes": [
    "data:image/webp",
    "blog:",
    "troubleshooting:",
    "mailto:"
  ],
  "lastrun": "2025-11-16 17:16:190",
  "runtime": 1.6845654590333332,
  "runtime_unit": "min",
  "found": 3759,
  "dropped": 106,
  "finished": false,
  "total": 3653,
  "ok": 3610,
  "broken": 41,
  "skipped": 2,
  "links_ok": [
    {
      "url": "http://192.168.178.91:81/",
      "state": "OK",
      "status": 200,
      "scantime": "2025-11-16 17:16:268"
    }
  ],
  "links_broken": [],
  "links_skipped": []
}
```

Das Ergebnis des scans liegt am besten im hugo data verzeichnis, wo es im Page-Build ausgewertet werden kann. Zum Beispiel mit diesem Shortcode:

## Shortcode broken-links.html

```go
{{- $my_state := "" -}} {{/* INFO, BROKEN, SKIPPED, OK */}}
{{- $my_mode := "" -}} {{/* intern, extern, all */}}

{{ $list := slice -}}

{{/* Defekte Links, siehe auch: link-check.md, broken-links.html, render-link.html, links-check.ts */}}

{{- if .IsNamedParams -}}
{{- $my_state = .Get "state" | default "BROKEN" -}}
{{- $my_mode = .Get "mode" | default "intern" -}} {{/* intern extern all*/}}

{{- else -}}
{{ errorf "Shortcode zitate.html: No Named Parameters provided!" }}
{{- end -}}

{{ $data := slice }}

{{ if eq $my_mode "intern"}}
{{ $data = site.Data.links_checked.internal }}
{{ else if eq $my_mode "extern"}}
{{ $data = site.Data.links_checked.external }}
{{ else }} {{/* all */}}
{{ $data = site.Data.links_checked }}
{{ end }}

{{/* TODO: .Destination | safeURL */}}
{{/* https://discourse.gohugo.io/t/iterate-through-an-array-of-nested-maps-json-objects/15028 */}}

{{ if eq $my_state "INFO"}} {{/* INFO or LINKS */}}

{{/* OUPTUT INFO */}}

<ul>
  {{ range $data }} {{/* Only one */}}
  <li>scanned: {{ .scan_source }}</li>

  <li>lastrun: {{ .lastrun }}</li>
  <li>runtime: {{ math.Round .runtime }} {{ .runtime_unit }} ({{ .runtime }})</li>
  <li>finished: {{ .finished }}</li>

  <li>found: {{ .found }}</li>
  <li>dropped: {{ .dropped }}</li>

  <li>total: {{ .total }}</li>
  <li>ok: {{ .ok }}</li>
  <li>broken: {{ .broken }}</li>
  <li>skipped: {{ .skipped }}</li>
  {{ end }}
</ul>

{{ else }} {{/* INFO OR LINKS */}}

{{/* OUPTUT LINKS */}}

{{/* Alle Links sammeln die zu einem parent gehören */}}

{{ $groups := slice }}

{{ range $data }}
{{ range .links_broken }}
{{ $groups = $groups | append .parent }}
{{ end }}
{{ end }}

{{ $groups = $groups | uniq | sort }}

<ul>
  {{ range $groups }}
  {{ $u := urls.Parse . }}
  <li><a href="{{.}}">{{ $u.Path }}</a>

    <ul>
      {{ $d := index $data 0 }} {{/* Only one */}}

      {{ $source := $d.links_broken }}
      {{/* TODO immer andere Quelle: $d.links_broken ja nach $my_state "BROKEN" */}}
      {{ if eq $my_state "BROKEN"}}
      {{ $source = $d.links_broken }}
      {{ else if eq $my_state "SKIPPED"}}
      {{ $source = $d.links_skipped }}
      {{ else if eq $my_state "OK"}}
      {{ $source = $d.links_ok }}
      {{ end }}

      {{ range where $source "parent" . }}

      {{/* shorten links for display: hallo-welt.de/../slug-ende/ */}}
      {{/* https://gohugo.io/functions/urls/parse/ */}}

      {{ if eq $my_state .state }}

      {{ $u := urls.Parse .url }}
      {{ $path := ""}}
      {{ if ne $u.Path "/"}}
      {{ $path = $u.Path }}
      {{else}}
      {{ $path = $u.Path }}
      {{ end }}

      <li>
        <a href="{{.url}}">
          {{ if eq .state "BROKEN" }}
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-linecap="round" stroke-linejoin="round" width="24" height="24" stroke-width="2">
            <path d="M9 15l3 -3m2 -2l1 -1"></path>
            <path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464"></path>
            <path d="M3 3l18 18"></path>
            <path d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463"></path>
          </svg>
          {{ else if eq .state "OK"}}
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-linecap="round" stroke-linejoin="round" width="24" height="24" stroke-width="2">
            <path d="M9 15l6 -6"></path>
            <path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464"></path>
            <path d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463"></path>
          </svg>
          {{ else if eq .state "SKIPPED"}}
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-linecap="round" stroke-linejoin="round" width="24" height="24" stroke-width="2">
            <path d="M9 15l6 -6"></path>
            <path d="M11 6l.463 -.536a5 5 0 1 1 7.071 7.072l-.534 .464"></path>
            <path d="M12.603 18.534a5.07 5.07 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463"></path>
            <path d="M16 19h6"></path>
          </svg>
          {{ end }}
        </a>├ {{ $u.Hostname }} ┼ {{ $path }}
      </li>

      {{ end }} {{/* eq my_State .state */}}
      {{ end }} {{/* range where $d.links_broken "parent" . */}}
    </ul>

  </li>
  {{ end }}
</ul>

{{end }} {{/* INFO ORE LINKS */}}
```

## Links kennzeichnen in Hugo

`layouts/_default/_markup/render-link.html`

```go
{{/* Externe Links mit Icon kennzeichnen */}}
{{/* Broken-Links kennzeichnen */}}
{{/* Siehe auch: link-check.md, broken-links.html, render-link.html, links-check.ts */}}

{{ $link := .Destination | safeURL }}
{{ $url := urls.Parse $link }}
{{ $message := "The link ist okay (200)" }}
{{ $is_broken_link := false }}

{{ if $url.IsAbs }}
{{/* external link -> komplett überprüfen */}}

{{ $data := site.Data.links_checked.external }} {{/* all links_broken */}}
{{ $d := index $data 0 }} {{/* Only one */}}
{{ $links_broken_array := $d.links_broken }}

{{ range $links_broken_array }}

{{if strings.Contains $link .url }}

{{ if eq (string .status) "0" }} {{/* i have to cast .status to string to compare */}}
{{ $message = println "This link seems okay with status=" .status }}
{{ else if eq (string .status) "404" }}
{{ $message = println "Sorry, this link does no longer exist, status=" .status }}
{{ $is_broken_link = true }}
{{ else if eq (string .status) "403" }}
{{ $message = println "Sorry, access to this link seems forbidden, status=" .status }}
{{ $is_broken_link = true }}
{{ else }}
{{ $message = println "Sorry, this link seems broken with status=" .status }}
{{ $is_broken_link = true }}
{{ end }} {{/* if status */}}
{{ end }} {{/* if url */}}
{{ end }} {{/* range */}}

{{ else }} {{/* if $url.IsAbs */}}
{{/* internal link -> nur path-anteil überprüfen */}}

{{ $data := site.Data.links_checked.internal }} {{/* all links_broken */}}
{{ $d := index $data 0 }} {{/* Only one */}}
{{ $links_broken_array := $d.links_broken }}

{{ range $links_broken_array }}
{{ $url_test := urls.Parse .url }}
{{if strings.Contains $url.Path $url_test.Path }}

{{ if eq (string .status) "0" }}
{{ $message = println "This link seems to be okay, but with status=" .status }}
{{ else if eq (string .status) "404" }}
{{ $message = println "Sorry, this link does no longer exist, status=" .status }}
{{ $is_broken_link = true }}
{{ else if eq (string .status) "403" }}
{{ $message = println "Sorry, access to this link seems forbidden, status=" .status }}
{{ $is_broken_link = true }}
{{ else }}
{{ $message = println "Sorry, this link seems broken with status=" .status }}
{{ $is_broken_link = true }}
{{ end }} {{/* if status */}}
{{ end }} {{/* if url */}}
{{ end }} {{/* range */}}

{{ end }} {{/* if $url.IsAbs */}}

<a {{ if $is_broken_link }} class="brokenlink" title="{{ $message }}" {{end}} href="{{ $link }}" {{ with .Title}}
  title="{{ . }}" {{ end }}>{{ .Text | safeHTML }}{{ if strings.HasPrefix .Destination "http" }}<span
    style="white-space: nowrap;">&thinsp;<svg style="margin-bottom: 5px" focusable="false"
      class="icon icon-tabler icon-tabler-external-link" role="img" xmlns="http://www.w3.org/2000/svg" width="14"
      height="14" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round"
      stroke-linejoin="round">
      <title>external link</title>
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" />
      <path d="M11 13l9 -9" />
      <path d="M15 4h5v5" />
    </svg></span>{{ end }}</a>

```
