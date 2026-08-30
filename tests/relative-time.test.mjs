import assert from "node:assert/strict";
import test from "node:test";
import { formatBackupRelativeTime } from "../src/relativeTime.js";

const now = Date.parse("2026-08-30T12:00:00+08:00");

test("backup relative time advances from just now through days", () => {
  assert.equal(formatBackupRelativeTime(now - 20_000, now), "刚刚");
  assert.equal(formatBackupRelativeTime(now - 5 * 60_000, now), "5 分钟前");
  assert.equal(formatBackupRelativeTime(now - 3 * 60 * 60_000, now), "3 小时前");
  assert.equal(formatBackupRelativeTime(now - 25 * 60 * 60_000, now), "1 天前");
});

test("backup relative time falls back to an absolute date after one week", () => {
  assert.equal(formatBackupRelativeTime("2026-08-20T12:00:00+08:00", now), "2026年8月20日");
});

test("backup relative time handles invalid and future values safely", () => {
  assert.equal(formatBackupRelativeTime("not-a-date", now), "时间未知");
  assert.equal(formatBackupRelativeTime(now + 60_000, now), "刚刚");
});
