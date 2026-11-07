const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");

const dateParse = require("../dist/shared/dateParse.js");
const { parseInputDate, formatInputDate, monthDays, isLeap } = dateParse;

function assert(condition, message) {
  if (!condition) throw new Error("Assertion failed: " + message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(message + ": expected \"" + expected + "\", got \"" + actual + "\"");
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("  ok  " + name);
    passed++;
  } catch (e) {
    console.error("FAIL  " + name);
    console.error("      " + (e instanceof Error ? e.message : String(e)));
    failed++;
  }
}

const fmt = "DD/MM/YYYY";

console.log("\n=== dateParse pure module tests ===");

test("parseInputDate rejects invalid 31/02/2020", () => assertEqual(parseInputDate("31/02/2020", fmt), null));
test("parseInputDate rejects invalid 45/13/2020", () => assertEqual(parseInputDate("45/13/2020", fmt), null));
test("parseInputDate rejects 29/02/2027 (non-leap)", () => assertEqual(parseInputDate("29/02/2027", fmt), null));
test("parseInputDate accepts 29/02/2028 (leap)", () => assertEqual(parseInputDate("29/02/2028", fmt), "2028-02-29"));
test("parseInputDate rejects 2020-02-31 (ISO invalid)", () => assertEqual(parseInputDate("2020-02-31", fmt), null));
test("parseInputDate rejects 2020-13-45 (ISO invalid)", () => assertEqual(parseInputDate("2020-13-45", fmt), null));
test("parseInputDate accepts 2024-12-31", () => assertEqual(parseInputDate("2024-12-31", fmt), "2024-12-31"));
test("parseInputDate accepts dd/mm/yyyy 01/01/2024", () => assertEqual(parseInputDate("01/01/2024", fmt), "2024-01-01"));
test("parseInputDate empty returns null", () => assertEqual(parseInputDate("", fmt), null));
test("parseInputDate bad text returns null", () => assertEqual(parseInputDate("abc", fmt), null));

test("formatInputDate 2024-01-15 => DD/MM/YYYY", () => assertEqual(formatInputDate("2024-01-15", "DD/MM/YYYY"), "15/01/2024"));
test("formatInputDate 2024-01-15 => MM/DD/YYYY", () => assertEqual(formatInputDate("2024-01-15", "MM/DD/YYYY"), "01/15/2024"));
test("formatInputDate 2024-01-15 => YYYY-MM-DD", () => assertEqual(formatInputDate("2024-01-15", "YYYY-MM-DD"), "2024-01-15"));

test("monthDays Jan 2024 = 31", () => assertEqual(monthDays(1, 2024), 31));
test("monthDays Feb 2024 (leap) = 29", () => assertEqual(monthDays(2, 2024), 29));
test("monthDays Feb 2023 (non-leap) = 28", () => assertEqual(monthDays(2, 2023), 28));
test("monthDays Apr 2024 = 30", () => assertEqual(monthDays(4, 2024), 30));

test("isLeap 2024 true", () => assertEqual(isLeap(2024), true));
test("isLeap 2023 false", () => assertEqual(isLeap(2023), false));
test("isLeap 2000 true (century leap)", () => assertEqual(isLeap(2000), true));
test("isLeap 1900 false (century non-leap)", () => assertEqual(isLeap(1900), false));

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed > 0) process.exitCode = 1;
else console.log("ALL PASSED");