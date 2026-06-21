import { describe, it, expect } from "vitest";
import {
  classifyTimeOfDay,
  classifyTimeOfDayFromDate,
  MORNING_START,
  AFTERNOON_START,
  EVENING_START,
  NIGHT_START,
} from "../../src/engine/timeOfDay.js";

// spec: changes/0005-timeOfDay-classification/spec.md
describe("timeOfDay", () => {
  describe("代表時刻", () => {
    it("classifies hour 7 as morning", () => {
      expect(classifyTimeOfDay(7)).toBe("morning");
    });

    it("classifies hour 13 as afternoon", () => {
      expect(classifyTimeOfDay(13)).toBe("afternoon");
    });

    it("classifies hour 18 as evening", () => {
      expect(classifyTimeOfDay(18)).toBe("evening");
    });

    it("classifies hour 23 as night", () => {
      expect(classifyTimeOfDay(23)).toBe("night");
    });
  });

  describe("深夜は night [境界]", () => {
    it("classifies hour 0 as night", () => {
      expect(classifyTimeOfDay(0)).toBe("night");
    });

    it("classifies hour 4 as night", () => {
      expect(classifyTimeOfDay(4)).toBe("night");
    });
  });

  describe("night → morning 境界 [境界]", () => {
    it("classifies hour 4 (= MORNING_START - 1) as night", () => {
      expect(classifyTimeOfDay(4)).toBe("night");
    });

    it("classifies hour 5 (= MORNING_START) as morning", () => {
      expect(classifyTimeOfDay(5)).toBe("morning");
    });
  });

  describe("morning → afternoon 境界 [境界]", () => {
    it("classifies hour 10 (= AFTERNOON_START - 1) as morning", () => {
      expect(classifyTimeOfDay(10)).toBe("morning");
    });

    it("classifies hour 11 (= AFTERNOON_START) as afternoon", () => {
      expect(classifyTimeOfDay(11)).toBe("afternoon");
    });
  });

  describe("afternoon → evening 境界 [境界]", () => {
    it("classifies hour 16 (= EVENING_START - 1) as afternoon", () => {
      expect(classifyTimeOfDay(16)).toBe("afternoon");
    });

    it("classifies hour 17 (= EVENING_START) as evening", () => {
      expect(classifyTimeOfDay(17)).toBe("evening");
    });
  });

  describe("evening → night 境界 [境界]", () => {
    it("classifies hour 20 (= NIGHT_START - 1) as evening", () => {
      expect(classifyTimeOfDay(20)).toBe("evening");
    });

    it("classifies hour 21 (= NIGHT_START) as night", () => {
      expect(classifyTimeOfDay(21)).toBe("night");
    });
  });

  describe("境界定数の値", () => {
    it("exports the agreed boundary constants", () => {
      expect(MORNING_START).toBe(5);
      expect(AFTERNOON_START).toBe(11);
      expect(EVENING_START).toBe(17);
      expect(NIGHT_START).toBe(21);
    });
  });

  describe("Date からの薄いラッパ", () => {
    it("delegates to classifyTimeOfDay(date.getHours())", () => {
      const date = new Date(2026, 5, 21, 18, 30, 0); // local 18:30
      expect(classifyTimeOfDayFromDate(date)).toBe("evening");
      expect(classifyTimeOfDayFromDate(date)).toBe(classifyTimeOfDay(date.getHours()));
    });

    it("works for night via Date", () => {
      const date = new Date(2026, 5, 21, 2, 0, 0); // local 02:00
      expect(classifyTimeOfDayFromDate(date)).toBe("night");
    });
  });

  describe("不変条件: 決定性", () => {
    it("returns the same result on repeated calls with the same input", () => {
      for (let h = 0; h < 24; h++) {
        expect(classifyTimeOfDay(h)).toBe(classifyTimeOfDay(h));
      }
    });

    it("covers every hour 0..23 with exactly one of the 4 values", () => {
      const allowed = new Set(["morning", "afternoon", "evening", "night"]);
      for (let h = 0; h < 24; h++) {
        expect(allowed.has(classifyTimeOfDay(h))).toBe(true);
      }
    });
  });
});
