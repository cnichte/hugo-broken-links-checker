#!/usr/bin/env node
/**
 * hugo-broken-links-checker
 *
 * Ist Teil der Hugo-Toolbox aber auch als eigenständiges CLI nutzbar.
 * 
 * - CLI-Wrapper rund um linkinator.
 * - Konfiguration über: hugo-broken-links-checker.config.json (oder Datei via --config)
 * - Unterstützt mehrere Jobs
 * - Läuft idealerweise gegen `hugo server` zB. http://localhost:1313/ 
 * - Mode: "intern" | "extern" | "all"
 *
 * @author Carsten Nichte, 2025
 */
// bin/hugo-broken-links-checker.mjs
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
let SELECTED_JOB_NAME = null;
let OVERRIDE_MODE = null; // "intern" | "extern" | "all"

// positional args für: hugo-toolbox check-links <jobName> <mode> --dry-run
const positionals = [];

for (let i = 0; i < ARGS.length; i += 1) {
  const arg = ARGS[i];

  if (arg === "--config" && ARGS[i + 1]) {
    CONFIG_PATH = path.resolve(ARGS[i + 1]);
    i += 1;
  } else if (arg === "--dry-run" || arg === "-d") {
    DRY_RUN = true;
  } else if (arg === "--job" && ARGS[i + 1]) {
    SELECTED_JOB_NAME = ARGS[i + 1];
    i += 1;
  } else if (arg === "--mode" && ARGS[i + 1]) {
    const m = ARGS[i + 1].toLowerCase();
    if (m === "intern" || m === "extern" || m === "all") {
      OVERRIDE_MODE = m;
    } else {
      console.log(
        pc.yellow(
          `⚠️  Ungültiger Mode "${m}". Erlaubt: intern | extern | all – ignoriere Override.`
        )
      );
    }
    i += 1;
  } else if (arg.startsWith("-")) {
    // andere Flags ignorieren wir erstmal
  } else {
    // positional (jobName, mode)
    positionals.push(arg);
  }
}

// positional args wie bei sftp-sync interpretieren:
// hugo-toolbox check-links carsten-local all --dry-run
if (!SELECTED_JOB_NAME && positionals[0]) {
  SELECTED_JOB_NAME = positionals[0];
}
if (!OVERRIDE_MODE && positionals[1]) {
  const m = positionals[1].toLowerCase();
  if (m === "intern" || m === "extern" || m === "all") {
    OVERRIDE_MODE = m;
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
// Default-Konfiguration + Laden (entspricht altem BLC_Parameter)
// ---------------------------------------------------------

const DEFAULT_CHECK_OPTIONS = {
  path: "",
  // port: 8673,
  concurrency: 100,
  // exakt wie im alten Skript:
  recurse: true,
  skip: "www.googleapis.com",
  format: "json",
  silent: true,
  verbosity: "error",
  timeout: 0,
  // markdown: true,
  // serverRoot: './',
  directoryListing: true,
  retry: true,
  retryErrors: true,
  retryErrorsCount: 3,
  retryErrorsJitter: 5,
  userAgent: "Mozilla/4.0 (compatible; MSIE 6.0; MSIE 5.5; Windows NT 5.1)",
  // linksToSkip: [] // optional später
};

const DEFAULT_JOB = {
  // entspricht BLC_Parameter
  name: "default",
  scan_source: "http://localhost:1313/", // z.B. Hugo dev server
  write_to: "data/links_checked/external.json",
  write_to_prefix: null, // optional, für carsten-local-all.json etc.
  date_format: "yyyy-MM-dd HH:mm:SSS",
  mode: "extern", // "extern" | "intern" | "all"
  special_excludes: [
    "data:image/webp",
    "data:image/",
    "blog:",
    "troubleshooting:",
    "mailto:",
  ],
  checkOptions: { ...DEFAULT_CHECK_OPTIONS },
};

const DEFAULT_CONFIG = {
  jobs: [DEFAULT_JOB],
};

// NEU: loadConfig kann jetzt sowohl jobs[] als auch scanJobs verwenden
async function loadConfig() {
  if (!CONFIG_PATH) {
    console.log(
      pc.yellow(
        "⚠️  Keine hugo-broken-links-checker.config.json gefunden – verwende Default-Konfiguration."
      )
    );
    return DEFAULT_CONFIG;
  }

  try {
    const raw = await fsp.readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);

    // Fall 1: Altes Schema – jobs: [...]
    if (parsed.jobs && Array.isArray(parsed.jobs) && parsed.jobs.length > 0) {
      const jobs = parsed.jobs.map((j, idx) => ({
        ...DEFAULT_JOB,
        ...j,
        name: j.name || `job-${idx + 1}`,
        checkOptions: {
          ...DEFAULT_CHECK_OPTIONS,
          ...(j.checkOptions || {}),
        },
      }));
      return { jobs };
    }

    // Fall 2: Neues Schema – scanJobs + defaultJob
    if (parsed.scanJobs && typeof parsed.scanJobs === "object") {
      const jobs = [];
      for (const [name, jobCfg] of Object.entries(parsed.scanJobs)) {
        const job = {
          ...DEFAULT_JOB,
          ...jobCfg,
          name,
          checkOptions: {
            ...DEFAULT_CHECK_OPTIONS,
            ...(jobCfg.checkOptions || {}),
          },
          write_to_prefix: jobCfg.write_to_prefix || null,
        };

        // write_to aus Prefix + Mode bauen, falls kein explizites write_to da ist
        if (!job.write_to && job.write_to_prefix) {
          const modeSlug = (job.mode || "all").toLowerCase();
          job.write_to = `${job.write_to_prefix}${modeSlug}.json`;
        }

        jobs.push(job);
      }

      if (!jobs.length) {
        console.log(
          pc.yellow(
            "⚠️  scanJobs ist leer – verwende Default-Konfiguration."
          )
        );
        return DEFAULT_CONFIG;
      }

      return { jobs };
    }

    console.log(
      pc.yellow(
        "⚠️  Konfigurationsdatei hat weder 'jobs' noch 'scanJobs' – verwende Default-Job."
      )
    );
    return DEFAULT_CONFIG;
  } catch (e) {
    console.error(pc.red("❌ Fehler beim Lesen der Config-Datei:"), e.message);
    process.exit(1);
  }
}

// ---------------------------------------------------------
// Duration-Helfer (wie früher)
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
    // Ausgabe aktuell in Minuten – wie im alten Skript
    return (performance.now() - this.beginTime) / 60000;
  }

  getDurationUnit() {
    return this.durationUnit;
  }
}

// ---------------------------------------------------------
// Datenstrukturen (entsprechend BLC_Scan_Summary)
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

function printHeader({ jobs }) {
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
  console.log(`   Jobs:    ${pc.cyan(String(jobs.length))}`);
  if (SELECTED_JOB_NAME) {
    console.log(`   Filter:  Job = ${pc.cyan(SELECTED_JOB_NAME)}`);
  }
  if (OVERRIDE_MODE) {
    console.log(`   Mode-Override: ${pc.cyan(OVERRIDE_MODE)}`);
  }
  if (DRY_RUN) {
    console.log(`   Mode:    ${pc.yellow("DRY-RUN (keine Schreibzugriffe)")}`);
  }
  console.log("");
}

function printJobSummary(job, summary) {
  const jobLabel = job.name
    ? `${job.name} (${job.mode || "extern"})`
    : job.mode || "extern";

  console.log(
    pc.bold(
      `\n📋 Job: ${pc.cyan(jobLabel)} – ${pc.green(job.scan_source)}`
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
// Helper: Excludes (wie isSpecialExclude in deinem alten Code)
// ---------------------------------------------------------

function isSpecialExclude(resultItem, job) {
  if (!job.special_excludes || job.special_excludes.length === 0) {
    return false;
  }

  for (const ex of job.special_excludes) {
    if (resultItem.url.startsWith(ex)) {
      // bei Bedarf wieder lauter machen:
      // console.log(pc.dim(`   ↳ Skip (special): ${resultItem.url}`));
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------
// Kernlogik pro Job (entspricht run_job aus dem alten Skript)
// ---------------------------------------------------------

async function runJob(jobRaw) {
  // Defaults + Job-Konfiguration mischen (wie dice_parameters)
  const job = {
    ...DEFAULT_JOB,
    ...jobRaw,
    checkOptions: {
      ...DEFAULT_CHECK_OPTIONS,
      ...(jobRaw.checkOptions || {}),
    },
  };

  // ggf. Mode Override
  if (OVERRIDE_MODE) {
    job.mode = OVERRIDE_MODE;
  }

  // falls write_to_prefix gesetzt ist, write_to daraus ableiten
  if (job.write_to_prefix) {
    const modeSlug = (job.mode || "all").toLowerCase();
    job.write_to = `${job.write_to_prefix}${modeSlug}.json`;
  }

  const duration = new Duration();
  duration.start();

  const summary = createScanSummary(job);
  summary.lastrun = format(
    new Date(),
    job.date_format || DEFAULT_JOB.date_format
  );

  const jsonArrayWrapper = [summary]; // Hugo mag Array

  // Zielpfad-Verzeichnis anlegen
  const outPath = path.resolve(job.write_to);
  const outDir = path.dirname(outPath);
  await fsp.mkdir(outDir, { recursive: true });

  // alte Datei löschen (wenn nicht dry-run)
  if (!DRY_RUN && fs.existsSync(outPath)) {
    await fsp.unlink(outPath);
  }

  const checker = new LinkChecker();

  // pagestart-Event – wie früher
  checker.on("pagestart", (url) => {
    console.log(pc.blue(`🌐 Scanning page: ${url}`));
  });

  // link-Event – entspricht deinem alten 'checker.on("link", ...)'
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

    // Special Excludes
    if (isSpecialExclude(resultItem, job)) {
      summary.dropped += 1;
      return;
    }

    // interne / externe / alle – exakt wie vorher:
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
    // "all" → nichts droppen

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

    // Zwischenstand schreiben (wie count_push_write)
    if (!DRY_RUN) {
      fs.writeFileSync(outPath, JSON.stringify(jsonArrayWrapper, null, 2), "utf8");
    }
  });

  // -------------------------------------------------------
  // Scan starten – wie "param.checkOptions.path = param.scan_source"
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

  // ggf. nach Job-Name filtern
  let jobs = config.jobs;
  if (SELECTED_JOB_NAME) {
    jobs = jobs.filter((j) => j.name === SELECTED_JOB_NAME);
    if (jobs.length === 0) {
      console.log(
        pc.red(
          `❌ Kein Job mit name="${SELECTED_JOB_NAME}" in Config gefunden.`
        )
      );
      process.exit(1);
    }
  }

  printHeader({ jobs });

  for (const job of jobs) {
    // sequentiell – Ausgabe lesbarer
    // eslint-disable-next-line no-await-in-loop
    await runJob(job);
  }

  printFooter();
}

main().catch((e) => {
  console.error(pc.red("❌ Unerwarteter Fehler in hugo-broken-links:"), e);
  process.exit(1);
});