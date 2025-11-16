#!/usr/bin/env node
/**
 * Hugo Broken Link Checker.
 * 
 * Ist Teil der Hugo-Toolbox aber auch als eigenständiges CLI nutzbar.
 * 
 * @author Carsten Nichte, 2024
 * 
 * Konfiguration über: hugo-broken-links-checker.config.json (oder Datei via --config)
 * Läuft idealerweise gegen `hugo server` zB. http://localhost:1313/ 
 */
// bin/hugo-broken-link-checker.mjs
import { LinkChecker } from "linkinator";
import { performance } from "perf_hooks";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import pc from "picocolors";
import { format } from "date-fns";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

// ---------------------------------------------------------
// CLI-Argumente
// ---------------------------------------------------------

const ARGS = process.argv.slice(2);

let CONFIG_PATH = null;
let DRY_RUN = false;

for (let i = 0; i < ARGS.length; i += 1) {
  const arg = ARGS[i];
  if (arg === "--config" && ARGS[i + 1]) {
    CONFIG_PATH = path.resolve(ARGS[i + 1]);
    i += 1;
  } else if (arg === "--dry-run" || arg === "-d") {
    DRY_RUN = true;
  }
}

// Default-Konfig-Datei, falls nichts angegeben
if (!CONFIG_PATH) {
  const candidate = path.resolve("hugo-broken-links-checker.config.json");
  if (fs.existsSync(candidate)) {
    CONFIG_PATH = candidate;
  }
}

// ---------------------------------------------------------
// Default-Konfiguration + Laden
// ---------------------------------------------------------

const DEFAULT_JOB = {
  scan_source: "http://localhost:1313/",
  write_to: "data/links_checked/external.json",
  date_format: "yyyy-MM-dd HH:mm:ss",
  mode: "extern", // "extern" | "intern" | "all"
  special_excludes: ["data:image/", "mailto:", "blog:", "troubleshooting:"],
  checkOptions: {
    path: "",
    concurrency: 100,
    recurse: true,
    skip: "www.googleapis.com",
    format: "json",
    silent: true,
    verbosity: "error",
    timeout: 0,
    directoryListing: true,
    retry: true,
    retryErrors: true,
    retryErrorsCount: 3,
    retryErrorsJitter: 5,
    userAgent:
      "Mozilla/4.0 (compatible; MSIE 6.0; MSIE 5.5; Windows NT 5.1)",
  },
};

const DEFAULT_CONFIG = {
  jobs: [DEFAULT_JOB],
};

async function loadConfig() {
  if (!CONFIG_PATH) {
    console.log(
      pc.yellow(
        "⚠️  Keine hugo-broken-links.config.json gefunden – verwende Default-Konfiguration."
      )
    );
    return DEFAULT_CONFIG;
  }

  try {
    const raw = await fsp.readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);

    if (!parsed.jobs || !Array.isArray(parsed.jobs) || parsed.jobs.length === 0) {
      console.log(
        pc.yellow(
          "⚠️  Konfigurationsdatei hat kein gültiges 'jobs'-Array – verwende Default-Job."
        )
      );
      return DEFAULT_CONFIG;
    }

    return parsed;
  } catch (e) {
    console.error(pc.red("❌ Fehler beim Lesen der Config-Datei:"), e.message);
    process.exit(1);
  }
}

// ---------------------------------------------------------
// Duration-Helfer
// ---------------------------------------------------------

class Duration {
  constructor() {
    this.beginTime = 0;
    this.durationUnit = "min";
  }

  start() {
    this.beginTime = performance.now();
  }

  getDuration() {
    // Ausgabe aktuell in Minuten
    return (performance.now() - this.beginTime) / 60000;
  }

  getDurationUnit() {
    return this.durationUnit;
  }
}

// ---------------------------------------------------------
// Datenstrukturen (Plain JS Objekte)
// ---------------------------------------------------------

function createScanSummary(job) {
  return {
    scan_source: job.scan_source,
    mode: job.mode || "extern",
    special_excludes: job.special_excludes || [],

    lastrun: "",
    runtime: 0,
    runtime_unit: "min",

    found: 0,
    dropped: 0,

    finished: false,

    total: 0,

    ok: 0,
    broken: 0,
    skipped: 0,

    links_ok: [],
    links_broken: [],
    links_skipped: [],
  };
}

// ---------------------------------------------------------
// Helper: Logging Header / Footer
// ---------------------------------------------------------

function printHeader(config) {
  console.log("\n" + "-".repeat(65));
  console.log(
    pc.bold(
      `🔗 hugo-broken-links  v${pkg.version || "0.0.0"}  (Broken Link Checker)`
    )
  );
  if (CONFIG_PATH) {
    console.log(
      `   Config:  ${pc.cyan(path.relative(process.cwd(), CONFIG_PATH))}`
    );
  } else {
    console.log(`   Config:  ${pc.yellow("Default (keine Datei gefunden)")}`);
  }
  console.log(`   Jobs:    ${pc.cyan(String(config.jobs.length))}`);
  if (DRY_RUN) {
    console.log(`   Mode:    ${pc.yellow("DRY-RUN (keine Schreibzugriffe)")}`);
  }
  console.log("");
}

function printJobSummary(job, summary) {
  console.log(
    pc.bold(
      `\n📋 Job: ${pc.cyan(job.mode || "extern")} – ${pc.green(job.scan_source)}`
    )
  );
  console.log(
    `   Laufzeit:   ${summary.runtime.toFixed(2)} ${summary.runtime_unit}`
  );
  console.log(
    `   Gefunden:   ${summary.found} (ausgewertet: ${summary.total}, gedroppt: ${summary.dropped})`
  );
  console.log(
    `   Ergebnisse: ${pc.green("OK " + summary.ok)}, ${pc.red(
      "BROKEN " + summary.broken
    )}, ${pc.yellow("SKIPPED " + summary.skipped)}`
  );
  console.log(`   Output:     ${pc.cyan(job.write_to)}`);
}

function printFooter() {
  console.log("\n" + "-".repeat(65) + "\n");
}

// ---------------------------------------------------------
// Helper: Excludes
// ---------------------------------------------------------

function isSpecialExclude(resultItem, job) {
  if (!job.special_excludes || job.special_excludes.length === 0) {
    return false;
  }

  for (const ex of job.special_excludes) {
    if (resultItem.url.startsWith(ex)) {
      // Optional: auskommentieren falls zu noisy
      // console.log(pc.dim(`   ↳ Skip (special): ${resultItem.url}`));
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------
// Kernlogik pro Job
// ---------------------------------------------------------

async function runJob(jobRaw) {
  // Defaults + Job-Konfiguration mischen
  const job = {
    ...DEFAULT_JOB,
    ...jobRaw,
    checkOptions: {
      ...DEFAULT_JOB.checkOptions,
      ...(jobRaw.checkOptions || {}),
    },
  };

  const duration = new Duration();
  duration.start();

  const summary = createScanSummary(job);
  summary.lastrun = format(new Date(), job.date_format || DEFAULT_JOB.date_format);

  const jsonArrayWrapper = [summary]; // Hugo mag Array

  // ggf. Zielpfad-Verzeichnis anlegen
  const outPath = path.resolve(job.write_to);
  const outDir = path.dirname(outPath);
  await fsp.mkdir(outDir, { recursive: true });

  // ggf. alte Datei löschen (nur wenn nicht dry-run)
  if (!DRY_RUN && fs.existsSync(outPath)) {
    await fsp.unlink(outPath);
  }

  const checker = new LinkChecker();

  checker.on("pagestart", (url) => {
    console.log(pc.blue(`🌐 Scanning page: ${url}`));
  });

  checker.on("link", (result) => {
    summary.found += 1;

    const resultItem = {
      url: result.url,
      state: result.state,
      status: result.status,
      scantime: format(
        new Date(),
        job.date_format || DEFAULT_JOB.date_format
      ),
      parent: result.parent,
    };

    if (isSpecialExclude(resultItem, job)) {
      summary.dropped += 1;
      return;
    }

    // Modus: intern / extern / all
    const isInternal = resultItem.url.startsWith(job.scan_source);

    if (job.mode === "intern") {
      if (!isInternal) {
        summary.dropped += 1;
        return;
      }
    } else if (job.mode === "extern") {
      if (isInternal) {
        summary.dropped += 1;
        return;
      }
    }

    // ab hier wird gezählt
    summary.total += 1;

    if (result.state === "OK") {
      summary.ok += 1;
      summary.links_ok.push(resultItem);
    } else if (result.state === "BROKEN") {
      summary.broken += 1;
      summary.links_broken.push(resultItem);
    } else if (result.state === "SKIPPED") {
      summary.skipped += 1;
      summary.links_skipped.push(resultItem);
    }

    summary.runtime = duration.getDuration();
    summary.runtime_unit = duration.getDurationUnit();

    // Zwischenstand schreiben (damit man während des Scans schon Daten hat)
    if (!DRY_RUN) {
      fs.writeFileSync(outPath, JSON.stringify(jsonArrayWrapper, null, 2), "utf8");
    }
  });

  // -------------------------------------------------------
  // Scan starten
  // -------------------------------------------------------
  job.checkOptions.path = job.scan_source;

  console.log(
    pc.cyan(
      `\n▶️  Starte Link-Scan (${job.mode || "extern"}) für ${job.scan_source}`
    )
  );

  const result = await checker.check(job.checkOptions);

  // Abschluss-Messung
  summary.runtime = duration.getDuration();
  summary.runtime_unit = duration.getDurationUnit();
  summary.finished = true;

  if (!DRY_RUN) {
    fs.writeFileSync(outPath, JSON.stringify(jsonArrayWrapper, null, 2), "utf8");
  }

  console.log(
    pc.cyan(
      `\n   Scan fertig: ${
        result.passed ? pc.green("PASSED 😀") : pc.red("FAILED 😢")
      }`
    )
  );
  console.log(`   Insgesamt geprüfte Links: ${result.links.length}`);
  const brokenLinksCount = result.links.filter((x) => x.state === "BROKEN");
  console.log(
    `   Davon broken: ${brokenLinksCount.length} (Details: ${path.relative(
      process.cwd(),
      outPath
    )})`
  );

  printJobSummary(job, summary);
}

// ---------------------------------------------------------
// main()
// ---------------------------------------------------------

async function main() {
  const config = await loadConfig();
  printHeader(config);

  for (const job of config.jobs) {
    // sequentiell, damit Ausgabe lesbarer bleibt
    // (könnte man parallelisieren, braucht man hier aber nicht)
    // eslint-disable-next-line no-await-in-loop
    await runJob(job);
  }

  printFooter();
}

main().catch((e) => {
  console.error(pc.red("❌ Unerwarteter Fehler in hugo-broken-links:"), e);
  process.exit(1);
});