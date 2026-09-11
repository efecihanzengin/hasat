import { describe, it, expect } from "vitest";
import {
  decomposeSeconds,
  formatClockTime,
  formatSrtTimestamp,
  formatTxtTimestamp,
  formatVttTimestamp,
} from "../src/timestamp.js";

describe("timestamp utilities", () => {
  describe("decomposeSeconds", () => {
    it("handles 0.0s correctly", () => {
      expect(decomposeSeconds(0)).toEqual({
        hours: 0,
        minutes: 0,
        seconds: 0,
        milliseconds: 0,
      });
    });

    it("clamps negative numbers and non-finite values to 0", () => {
      expect(decomposeSeconds(-5)).toEqual({
        hours: 0,
        minutes: 0,
        seconds: 0,
        milliseconds: 0,
      });
      expect(decomposeSeconds(NaN)).toEqual({
        hours: 0,
        minutes: 0,
        seconds: 0,
        milliseconds: 0,
      });
      expect(decomposeSeconds(Infinity)).toEqual({
        hours: 0,
        minutes: 0,
        seconds: 0,
        milliseconds: 0,
      });
    });

    it("handles fractional seconds and sub-second precision", () => {
      expect(decomposeSeconds(0.001)).toEqual({
        hours: 0,
        minutes: 0,
        seconds: 0,
        milliseconds: 1,
      });
      expect(decomposeSeconds(0.5)).toEqual({
        hours: 0,
        minutes: 0,
        seconds: 0,
        milliseconds: 500,
      });
      expect(decomposeSeconds(0.999)).toEqual({
        hours: 0,
        minutes: 0,
        seconds: 0,
        milliseconds: 999,
      });
      expect(decomposeSeconds(12.3456)).toEqual({
        hours: 0,
        minutes: 0,
        seconds: 12,
        milliseconds: 346,
      });
    });

    it("handles minute boundary transitions", () => {
      expect(decomposeSeconds(59)).toEqual({
        hours: 0,
        minutes: 0,
        seconds: 59,
        milliseconds: 0,
      });
      expect(decomposeSeconds(59.999)).toEqual({
        hours: 0,
        minutes: 0,
        seconds: 59,
        milliseconds: 999,
      });
      expect(decomposeSeconds(60)).toEqual({
        hours: 0,
        minutes: 1,
        seconds: 0,
        milliseconds: 0,
      });
      expect(decomposeSeconds(60.001)).toEqual({
        hours: 0,
        minutes: 1,
        seconds: 0,
        milliseconds: 1,
      });
      expect(decomposeSeconds(61.5)).toEqual({
        hours: 0,
        minutes: 1,
        seconds: 1,
        milliseconds: 500,
      });
    });

    it("handles hour boundary transitions", () => {
      expect(decomposeSeconds(3599)).toEqual({
        hours: 0,
        minutes: 59,
        seconds: 59,
        milliseconds: 0,
      });
      expect(decomposeSeconds(3599.999)).toEqual({
        hours: 0,
        minutes: 59,
        seconds: 59,
        milliseconds: 999,
      });
      expect(decomposeSeconds(3600)).toEqual({
        hours: 1,
        minutes: 0,
        seconds: 0,
        milliseconds: 0,
      });
      expect(decomposeSeconds(3601.25)).toEqual({
        hours: 1,
        minutes: 0,
        seconds: 1,
        milliseconds: 250,
      });
    });

    it("handles durations exceeding 10 hours and 100 hours", () => {
      // 10 hours exact = 36000s
      expect(decomposeSeconds(36000)).toEqual({
        hours: 10,
        minutes: 0,
        seconds: 0,
        milliseconds: 0,
      });
      // 10 hours 12 minutes 5 seconds 123ms = 36725.123s
      expect(decomposeSeconds(36725.123)).toEqual({
        hours: 10,
        minutes: 12,
        seconds: 5,
        milliseconds: 123,
      });
      // 100 hours exact = 360000s
      expect(decomposeSeconds(360000)).toEqual({
        hours: 100,
        minutes: 0,
        seconds: 0,
        milliseconds: 0,
      });
    });
  });

  describe("formatSrtTimestamp", () => {
    it("formats 0.0s as 00:00:00,000", () => {
      expect(formatSrtTimestamp(0)).toBe("00:00:00,000");
    });

    it("formats fractional seconds with comma separator and 3-digit ms", () => {
      expect(formatSrtTimestamp(0.005)).toBe("00:00:00,005");
      expect(formatSrtTimestamp(0.05)).toBe("00:00:00,050");
      expect(formatSrtTimestamp(0.5)).toBe("00:00:00,500");
      expect(formatSrtTimestamp(4.123)).toBe("00:00:04,123");
    });

    it("formats minute boundary transitions", () => {
      expect(formatSrtTimestamp(59.999)).toBe("00:00:59,999");
      expect(formatSrtTimestamp(60.0)).toBe("00:01:00,000");
      expect(formatSrtTimestamp(60.001)).toBe("00:01:00,001");
      expect(formatSrtTimestamp(119.5)).toBe("00:01:59,500");
      expect(formatSrtTimestamp(120.0)).toBe("00:02:00,000");
    });

    it("formats hour boundary transitions", () => {
      expect(formatSrtTimestamp(3599.999)).toBe("00:59:59,999");
      expect(formatSrtTimestamp(3600.0)).toBe("01:00:00,000");
      expect(formatSrtTimestamp(3661.05)).toBe("01:01:01,050");
    });

    it("formats durations exceeding 10 hours and 100 hours", () => {
      expect(formatSrtTimestamp(36000)).toBe("10:00:00,000");
      expect(formatSrtTimestamp(36725.123)).toBe("10:12:05,123");
      expect(formatSrtTimestamp(360000)).toBe("100:00:00,000");
    });
  });

  describe("formatVttTimestamp", () => {
    it("formats 0.0s as 00:00:00.000 with dot separator", () => {
      expect(formatVttTimestamp(0)).toBe("00:00:00.000");
    });

    it("formats fractional seconds with dot separator and 3-digit ms", () => {
      expect(formatVttTimestamp(0.005)).toBe("00:00:00.005");
      expect(formatVttTimestamp(0.05)).toBe("00:00:00.050");
      expect(formatVttTimestamp(0.5)).toBe("00:00:00.500");
      expect(formatVttTimestamp(4.123)).toBe("00:00:04.123");
    });

    it("formats minute boundary transitions", () => {
      expect(formatVttTimestamp(59.999)).toBe("00:00:59.999");
      expect(formatVttTimestamp(60.0)).toBe("00:01:00.000");
      expect(formatVttTimestamp(60.001)).toBe("00:01:00.001");
    });

    it("formats hour boundary transitions", () => {
      expect(formatVttTimestamp(3599.999)).toBe("00:59:59.999");
      expect(formatVttTimestamp(3600.0)).toBe("01:00:00.000");
      expect(formatVttTimestamp(3661.05)).toBe("01:01:01.050");
    });

    it("formats durations exceeding 10 hours and 100 hours", () => {
      expect(formatVttTimestamp(36000)).toBe("10:00:00.000");
      expect(formatVttTimestamp(36725.123)).toBe("10:12:05.123");
      expect(formatVttTimestamp(360000)).toBe("100:00:00.000");
    });
  });

  describe("formatClockTime & formatTxtTimestamp", () => {
    it("formats sub-hour timestamps as mm:ss and [mm:ss]", () => {
      expect(formatClockTime(0)).toBe("00:00");
      expect(formatTxtTimestamp(0)).toBe("[00:00]");

      expect(formatClockTime(5.7)).toBe("00:05");
      expect(formatTxtTimestamp(5.7)).toBe("[00:05]");

      expect(formatClockTime(59.9)).toBe("00:59");
      expect(formatTxtTimestamp(59.9)).toBe("[00:59]");

      expect(formatClockTime(60.0)).toBe("01:00");
      expect(formatTxtTimestamp(60.0)).toBe("[01:00]");

      expect(formatClockTime(3599.9)).toBe("59:59");
      expect(formatTxtTimestamp(3599.9)).toBe("[59:59]");
    });

    it("formats >= 1 hour timestamps as hh:mm:ss and [hh:mm:ss]", () => {
      expect(formatClockTime(3600)).toBe("01:00:00");
      expect(formatTxtTimestamp(3600)).toBe("[01:00:00]");

      expect(formatClockTime(3661)).toBe("01:01:01");
      expect(formatTxtTimestamp(3661)).toBe("[01:01:01]");

      // Exceeding 10 hours
      expect(formatClockTime(36000)).toBe("10:00:00");
      expect(formatTxtTimestamp(36000)).toBe("[10:00:00]");

      expect(formatClockTime(36725)).toBe("10:12:05");
      expect(formatTxtTimestamp(36725)).toBe("[10:12:05]");

      // Exceeding 100 hours
      expect(formatClockTime(360000)).toBe("100:00:00");
      expect(formatTxtTimestamp(360000)).toBe("[100:00:00]");
    });
  });
});
